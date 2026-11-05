/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NavBar } from './NavBar';
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
      </ThemeProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  const memoryHistory = createMemoryHistory({ initialEntries: [initialPath] });
  router.update({ history: memoryHistory });
  return router;
}

const SECTION_LABELS = ['Overview', 'Runs', 'Insights', 'Map', 'GitHub', 'Settings'];

/** The section links: the direct children of the Sections list, not the pages under them. */
function sectionLinks(bar: HTMLElement): HTMLElement[] {
  const sections = within(bar).getByRole('list', { name: 'Sections' });
  return [...sections.children].map((item) => item.querySelector('a') as HTMLElement);
}

describe('NavBar', () => {
  beforeEach(() => {
    localStorage.clear();
    resetViewerRoleCache();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toggles theme', async () => {
    render(<RouterProvider router={makeRouter()} />);
    const themeBtn = await screen.findByTestId('theme-toggle');
    fireEvent.click(themeBtn);
    expect(localStorage.getItem('lupin-theme')).toBeDefined();
  });

  /*
   * The cycle is `dark → light → system → dark`, which is the declaration order of
   * `THEMES` in `ThemeProvider.tsx`. These cases exercise the real provider and real
   * `localStorage`; `ThemeToggle.test.tsx` covers the arithmetic against a mocked hook.
   */
  it('theme cycles: light → system when starting from light', async () => {
    localStorage.setItem('lupin-theme', 'light');
    render(<RouterProvider router={makeRouter()} />);
    fireEvent.click(await screen.findByTestId('theme-toggle'));
    expect(localStorage.getItem('lupin-theme')).toBe('system');
  });

  it('theme cycles: dark → light when starting from dark', async () => {
    localStorage.setItem('lupin-theme', 'dark');
    render(<RouterProvider router={makeRouter()} />);
    fireEvent.click(await screen.findByTestId('theme-toggle'));
    expect(localStorage.getItem('lupin-theme')).toBe('light');
  });

  it('is a fixed-width, full-height sidebar at every width: the console is desktop only', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    expect(bar).toHaveClass('h-full', 'w-60', 'flex-col');
    // No breakpoint hides or reshapes it, so no width shows a phone header instead.
    expect(bar.className).not.toMatch(/\b(sm|md|lg|xl):/u);
  });

  it('draws the six sections, in order', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    expect(sectionLinks(bar).map((link) => link.textContent)).toEqual(SECTION_LABELS);
  });

  it('lists every category with all its pages at once, not only the current one', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/runs')} />);
    const bar = await screen.findByTestId('nav-bar');
    const pagesOf = (label: string) =>
      within(within(bar).getByRole('list', { name: `${label} pages` }))
        .getAllByRole('link')
        .map((link) => link.textContent);
    expect(pagesOf('Overview')).toEqual(['Cockpit', 'Portfolio', 'Project']);
    expect(pagesOf('Runs')).toEqual(['Runs', 'Launch']);
    expect(pagesOf('Insights')).toEqual(['Tests', 'Delivery', 'AI code']);
    expect(pagesOf('GitHub')).toEqual(['Pull requests', 'Issues', 'Repositories']);
  });

  it('scrolls the list inside the sidebar, between the wordmark and the theme', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    const scroller = within(bar).getByTestId('nav-scroll');
    expect(scroller).toHaveClass('overflow-y-auto', 'min-h-0', 'flex-1');
    expect(within(scroller).getByRole('list', { name: 'Sections' })).toBeDefined();
    // The wordmark and the theme stay put while the list scrolls.
    expect(scroller).not.toContainElement(screen.getByTestId('nav-wordmark'));
    expect(scroller).not.toContainElement(screen.getByTestId('theme-toggle'));
  });

  it('is minimal: no new-run action, no recents and no collapse control', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    expect(within(bar).queryByRole('link', { name: 'New run' })).toBeNull();
    expect(within(bar).queryByRole('list', { name: 'Recent runs' })).toBeNull();
    expect(within(bar).queryByRole('button', { name: /sidebar/u })).toBeNull();
    expect(within(bar).getAllByRole('button')).toHaveLength(1);
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

  it.each([
    ['/dashboard', 'Overview'],
    ['/dashboard/runs/run-1', 'Runs'],
    ['/dashboard/runner', 'Runs'],
    ['/dashboard/analytics', 'Insights'],
    ['/dashboard/flaky/project-1', 'Insights'],
    ['/dashboard/health', 'Map'],
  ])('marks %s as inside the %s section', async (path, label) => {
    render(<RouterProvider router={makeRouter(path)} />);
    const bar = await screen.findByTestId('nav-bar');
    const current = sectionLinks(bar).filter(
      (link) => link.getAttribute('aria-current') === 'page',
    );
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });

  it('marks the current page within its section', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/insights')} />);
    const bar = await screen.findByTestId('nav-bar');
    const pages = within(bar).getByRole('list', { name: 'Insights pages' });
    expect(within(pages).getByRole('link', { name: 'Tests' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(pages).getByRole('link', { name: 'Delivery' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('marks no page on a detail page, and keeps its section current', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/runs/run-1')} />);
    const bar = await screen.findByTestId('nav-bar');
    const pages = within(bar).getByRole('list', { name: 'Runs pages' });
    expect(
      within(pages)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page'),
    ).toEqual([]);
    expect(within(bar).getByRole('link', { name: 'Runs', current: false })).toBeDefined();
  });

  it('shows the settings pages a signed-out reader may use, Appearance first', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/settings')} />);
    const bar = await screen.findByTestId('nav-bar');
    // fetch is mocked to 401, so `whoami` yields no role: a signed-out reader sees only the
    // two pages everyone may use, never the admin ones.
    await waitFor(() =>
      expect(
        within(within(bar).getByRole('list', { name: 'Settings pages' }))
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Appearance', 'Reports']),
    );
  });

  it('shows an admin every settings page, including the admin surfaces', async () => {
    resetViewerRoleCache();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ actor: 'you', role: 'admin', mode: 'enforced' }),
    });
    render(<RouterProvider router={makeRouter('/dashboard/settings')} />);
    const bar = await screen.findByTestId('nav-bar');
    await waitFor(() =>
      expect(
        within(within(bar).getByRole('list', { name: 'Settings pages' }))
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Appearance', 'Reports', 'Access', 'Members', 'Audit', 'Deployment']),
    );
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<RouterProvider router={makeRouter('/dashboard/runner')} />);
    await screen.findByTestId('nav-bar');
    await expectNoBlockingAxeViolations(container);
  });
});
