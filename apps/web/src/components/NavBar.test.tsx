/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NavBar, BottomTabBar, SectionTabs } from './NavBar';
import { ThemeProvider } from '../theme/ThemeProvider';
import { expectNoBlockingAxeViolations } from '../test-axe';
import { resetViewerRoleCache } from '../hooks/useViewerRole';
import { makeRun } from '../test-utils';
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
        <SectionTabs />
        <BottomTabBar />
      </ThemeProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  const memoryHistory = createMemoryHistory({ initialEntries: [initialPath] });
  router.update({ history: memoryHistory });
  return router;
}

const SECTION_LABELS = ['Overview', 'Runs', 'Insights', 'Map', 'GitHub', 'Settings'];

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

  it('draws the six sections in the sidebar, in order', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    const sections = within(bar).getByRole('list', { name: 'Sections' });
    const links = within(sections).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(SECTION_LABELS);
  });

  it('is a top header on a phone and a full-height left sidebar from lg', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    expect(bar).toHaveClass('lg:h-full', 'lg:w-64', 'lg:flex-col');
    // The sections, the section's pages and the recents are the sidebar's; a phone has the
    // bottom bar and the tab row for those.
    expect(within(bar).getByRole('list', { name: 'Sections' }).parentElement).toHaveClass(
      'hidden',
      'lg:flex',
    );
  });

  it("lists the current section's pages under it, with the current page marked", async () => {
    render(<RouterProvider router={makeRouter('/dashboard/insights')} />);
    const bar = await screen.findByTestId('nav-bar');
    const pages = within(bar).getByRole('list', { name: 'Insights pages' });
    expect(
      within(pages)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Tests', 'Delivery', 'AI code']);
    expect(within(pages).getByRole('link', { name: 'Tests' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('lists recent runs by short id, each linking to its detail page', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/v1/runs?limit=6')
        ? new Response(
            JSON.stringify([
              makeRun({ id: 'abcdef12-3456-4789-8abc-def012345678', suite: null }),
              makeRun({ id: 'run-two', suite: 'checkout' }),
            ]),
            { status: 200 },
          )
        : new Response('{}', { status: 401 }),
    ) as typeof fetch;
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    const recents = await within(bar).findByRole('list', { name: 'Recent runs' });
    const links = within(recents).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining('abcdef12'),
      expect.stringContaining('checkout'),
    ]);
    expect(links[0]).toHaveAttribute(
      'href',
      '/dashboard/runs/abcdef12-3456-4789-8abc-def012345678',
    );
  });

  it('collapses to an icon rail, keeps every section named, and remembers it', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    fireEvent.click(within(bar).getByRole('button', { name: 'Collapse sidebar' }));
    expect(bar).toHaveAttribute('data-collapsed', 'true');
    expect(bar).toHaveClass('lg:w-16');
    expect(localStorage.getItem('lupin-sidebar')).toBe('collapsed');
    // Collapsed is a rail of icons, and each is still a named link for a screen reader.
    const sections = within(bar).getByRole('list', { name: 'Sections' });
    expect(
      within(sections)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(SECTION_LABELS);
    expect(within(bar).queryByRole('list', { name: 'Recent runs' })).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Expand sidebar' })).toBeDefined();
  });

  it('offers a new run from the top of the sidebar', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    expect(within(bar).getByRole('link', { name: 'New run' })).toHaveAttribute(
      'href',
      '/dashboard/runner',
    );
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
  ])('marks %s as inside the %s section, in both bars', async (path, label) => {
    render(<RouterProvider router={makeRouter(path)} />);
    const bar = await screen.findByTestId('nav-bar');
    const bottom = screen.getByTestId('bottom-tab-bar');
    for (const nav of [within(bar).getByRole('list', { name: 'Sections' }), bottom]) {
      const current = within(nav)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current.map((link) => link.textContent)).toEqual([label]);
    }
  });

  it('gives the bottom bar six labelled, finger-sized targets', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bottom = await screen.findByTestId('bottom-tab-bar');
    expect(bottom).toHaveAttribute('aria-label', 'Sections');
    const links = within(bottom).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(SECTION_LABELS);
    for (const link of links) expect(link).toHaveClass('min-h-14');
    // Hidden from `lg` up, where the top bar carries the sections.
    expect(bottom).toHaveClass('lg:hidden');
  });

  it('navigates from the bottom bar', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bottom = await screen.findByTestId('bottom-tab-bar');
    fireEvent.click(within(bottom).getByRole('link', { name: 'Insights' }));
    await waitFor(() =>
      expect(within(bottom).getByRole('link', { name: 'Insights' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  });

  it('shows the section tabs for a section with more than one page', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/insights')} />);
    const tabs = await screen.findByTestId('section-tabs');
    expect(tabs).toHaveAttribute('aria-label', 'Insights pages');
    const links = within(tabs).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Tests', 'Delivery', 'AI code']);
    expect(within(tabs).getByRole('link', { name: 'Tests' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows no tab row on a page that left the tab row, and keeps its section current', async () => {
    // Trends is reached from the run pass rate now, so it is a detail page: a bookmark still
    // opens it, in Insights, with no tab row above it that would mark nothing as current.
    render(<RouterProvider router={makeRouter('/dashboard/analytics')} />);
    await screen.findByTestId('nav-bar');
    expect(screen.queryByTestId('section-tabs')).toBeNull();
    expect(
      within(screen.getByTestId('nav-bar')).getByRole('link', { name: 'Insights' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('shows the cockpit, portfolio and project tabs on the overview, and none on a detail page', async () => {
    const { unmount } = render(<RouterProvider router={makeRouter('/dashboard')} />);
    const tabs = await screen.findByTestId('section-tabs');
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Cockpit', 'Portfolio', 'Project']);
    unmount();
    render(<RouterProvider router={makeRouter('/dashboard/runs/run-1')} />);
    await screen.findByTestId('nav-bar');
    expect(screen.queryByTestId('section-tabs')).toBeNull();
  });

  it('shows the settings tabs a signed-out reader may use, Appearance first', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/settings')} />);
    const tabs = await screen.findByTestId('section-tabs');
    expect(tabs).toHaveAttribute('aria-label', 'Settings pages');
    // fetch is mocked to 401, so `whoami` yields no role: a signed-out reader sees only the
    // two tabs everyone may use, never the admin ones.
    await waitFor(() =>
      expect(
        within(tabs)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Appearance', 'Reports']),
    );
    expect(within(tabs).getByRole('link', { name: 'Appearance' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows an admin every settings tab, including the admin surfaces', async () => {
    resetViewerRoleCache();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ actor: 'you', role: 'admin', mode: 'enforced' }),
    });
    render(<RouterProvider router={makeRouter('/dashboard/settings')} />);
    const tabs = await screen.findByTestId('section-tabs');
    await waitFor(() =>
      expect(
        within(tabs)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Appearance', 'Reports', 'Access', 'Members', 'Audit', 'Deployment']),
    );
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<RouterProvider router={makeRouter('/dashboard/runner')} />);
    await screen.findByTestId('section-tabs');
    await expectNoBlockingAxeViolations(container);
  });
});
