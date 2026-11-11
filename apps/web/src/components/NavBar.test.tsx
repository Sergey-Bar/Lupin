import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NavBar, BottomTabBar } from './NavBar';
import { ThemeProvider } from '../theme/ThemeProvider';
import { expectNoBlockingAxeViolations } from '../test-axe';
import { resetViewerRoleCache } from '../hooks/useViewerRole';
import {
  createMemoryHistory,
  RouterProvider,
  createRouter,
  createRootRoute,
} from '@tanstack/react-router';

function makeRouter(initialPath = '/') {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider>
        <NavBar />
        <BottomTabBar />
      </ThemeProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  const memoryHistory = createMemoryHistory({ initialEntries: [initialPath] });
  router.update({ history: memoryHistory });
  return router;
}

const SECTION_LABELS = ['Home', 'Runs', 'Tests', 'Health', 'Settings'];

async function openDrawer() {
  fireEvent.click(await screen.findByRole('button', { name: 'Open navigation' }));
  return screen.findByRole('dialog', { name: 'Navigation' });
}

describe('NavBar, the phone top bar', () => {
  beforeEach(() => {
    localStorage.clear();
    resetViewerRoleCache();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the theme out of the chrome: it is set in Settings, Appearance', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await screen.findByTestId('nav-bar');
    expect(screen.queryByTestId('theme-toggle')).toBeNull();
  });

  it('renders the product wordmark once, in the corner', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await screen.findByTestId('nav-bar');
    expect(screen.getByTestId('nav-wordmark')).toHaveTextContent('Lupin');
    // Exactly once. A second copy is the rename having half happened — which is
    // what the retired-name gate in `scripts/lib/product-name.test.mjs` exists for.
    expect(screen.getAllByText('Lupin')).toHaveLength(1);
  });

  it('draws the wordmark as the site does: the name in sentence case, and a dot in the accent', async () => {
    render(<RouterProvider router={makeRouter()} />);
    const mark = await screen.findByTestId('nav-wordmark');
    expect(mark.className).not.toMatch(/\buppercase\b/);
    const dot = mark.querySelector('[data-wordmark-dot]');
    expect(dot?.textContent).toBe('.');
    expect(dot?.className).toMatch(/\btext-accent\b/);
  });

  it('draws no tab row on any page: every page is in the sidebar and the drawer', async () => {
    for (const path of ['/dashboard', '/dashboard/insights', '/dashboard/settings']) {
      const { unmount } = render(<RouterProvider router={makeRouter(path)} />);
      await screen.findByTestId('nav-bar');
      expect(screen.queryByTestId('section-tabs')).toBeNull();
      expect(screen.queryByRole('button', { name: /^More .* pages$/u })).toBeNull();
      unmount();
    }
  });

  it('opens a drawer holding every page of the place you are in, the old More pages included', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const drawer = await openDrawer();
    const health = within(drawer).getByRole('list', { name: 'Health pages' });
    expect(within(health).getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
      'href',
      '/dashboard/prs',
    );
    expect(within(health).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps focus inside the drawer, and closes it on Escape, on the close button and on a link', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    let drawer = await openDrawer();
    expect(drawer.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus();
    drawer = await openDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close navigation' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
    drawer = await openDrawer();
    fireEvent.click(within(drawer).getByRole('link', { name: 'Supply chain' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
  });

  it('wraps Tab from the last control in the drawer back to the first', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const drawer = await openDrawer();
    const focusable = [...drawer.querySelectorAll<HTMLElement>('a[href], button')];
    const last = focusable.at(-1) as HTMLElement;
    last.focus();
    fireEvent.keyDown(drawer, { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);
    (focusable[0] as HTMLElement).focus();
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('shows Settings mode in the drawer on a settings page, with only what the role may open', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/settings')} />);
    const drawer = await openDrawer();
    const nav = within(drawer).getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByRole('link', { name: 'Appearance' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // fetch is 401, so whoami yields no role: the admin pages are never listed.
    await waitFor(() => expect(within(nav).queryByRole('link', { name: 'Members' })).toBeNull());
  });

  it('shows an admin every settings page in the drawer, including the admin surfaces', async () => {
    resetViewerRoleCache();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ actor: 'you', role: 'admin', mode: 'enforced' }),
    });
    render(<RouterProvider router={makeRouter('/dashboard/settings')} />);
    const drawer = await openDrawer();
    const nav = within(drawer).getByRole('navigation', { name: 'Settings' });
    await waitFor(() =>
      expect(
        within(nav)
          .getAllByRole('link')
          .map((link) => link.textContent)
          .filter((text) => text !== 'Back to Lupin'),
      ).toEqual([
        'Appearance',
        'Projects',
        'Reports',
        'Quality gates',
        'Members',
        'AI provider',
        'Integrations',
        'Identity',
        'Sessions & retention',
        'Access',
        'Audit',
        'Deployment',
        'Map',
        'Toolbox',
      ]),
    );
  });

  it('names where you are in the top bar', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/insights')} />);
    expect(await screen.findByTestId('nav-place')).toHaveTextContent('Tests');
  });

  it('has no serious or critical axe violations, closed or open', async () => {
    const { container } = render(<RouterProvider router={makeRouter('/dashboard/runner')} />);
    await screen.findByTestId('nav-bar');
    await expectNoBlockingAxeViolations(container);
    await openDrawer();
    await expectNoBlockingAxeViolations(document.body);
  });
});

describe('BottomTabBar', () => {
  beforeEach(() => {
    localStorage.clear();
    resetViewerRoleCache();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
  });

  it.each([
    ['/dashboard', 'Health'],
    ['/dashboard/runs/run-1', 'Runs'],
    ['/dashboard/runner', 'Runs'],
    ['/dashboard/analytics', 'Tests'],
    ['/dashboard/flaky/project-1', 'Tests'],
    ['/dashboard/health', 'Health'],
  ])('marks %s as inside the %s section', async (path, label) => {
    render(<RouterProvider router={makeRouter(path)} />);
    const bottom = await screen.findByTestId('bottom-tab-bar');
    const current = within(bottom)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });

  it('gives the bottom bar five labelled, finger-sized targets', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bottom = await screen.findByTestId('bottom-tab-bar');
    expect(bottom).toHaveAttribute('aria-label', 'Sections');
    const links = within(bottom).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(SECTION_LABELS);
    for (const link of links) expect(link).toHaveClass('min-h-14');
    expect(bottom).toHaveClass('lg:hidden');
  });

  it('navigates from the bottom bar', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bottom = await screen.findByTestId('bottom-tab-bar');
    fireEvent.click(within(bottom).getByRole('link', { name: 'Runs' }));
    await waitFor(() =>
      expect(within(bottom).getByRole('link', { name: 'Runs' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  });
});
