/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NavBar, BottomTabBar, SectionTabs } from './NavBar';
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

const SECTION_LABELS = ['Now', 'Runs', 'Tests', 'Health', 'Delivery', 'Settings'];

describe('NavBar', () => {
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

  it('draws the six sections, and nothing else, in the top bar', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    const links = within(bar).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(SECTION_LABELS);
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
    ['/dashboard', 'Health'],
    ['/dashboard/runs/run-1', 'Runs'],
    ['/dashboard/runner', 'Runs'],
    ['/dashboard/analytics', 'Tests'],
    ['/dashboard/flaky/project-1', 'Tests'],
    ['/dashboard/health', 'Health'],
  ])('marks %s as inside the %s section, in both bars', async (path, label) => {
    render(<RouterProvider router={makeRouter(path)} />);
    const bar = await screen.findByTestId('nav-bar');
    const bottom = screen.getByTestId('bottom-tab-bar');
    for (const nav of [bar, bottom]) {
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
    fireEvent.click(within(bottom).getByRole('link', { name: 'Tests' }));
    await waitFor(() =>
      expect(within(bottom).getByRole('link', { name: 'Tests' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  });

  it('shows the tab row on a desktop too, since the sidebar lists only the areas', async () => {
    // The sidebar used to list every tab, so the row hid from `lg` up. The pyramid sidebar
    // lists the six areas only, and with the row hidden 25 of 48 pages had no link at all.
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const tabs = await screen.findByTestId('section-tabs');
    expect(tabs.className).not.toMatch(/(^|\s)lg:hidden(\s|$)/u);
    expect(within(tabs).getByRole('link', { name: 'Portfolio' })).toHaveAttribute(
      'href',
      '/dashboard/portfolio',
    );
  });

  it('keeps the current tab in view when the row is wider than the screen', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<RouterProvider router={makeRouter('/dashboard/settings')} />);
    const tabs = await screen.findByTestId('section-tabs');
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled.mock.contexts[0]).toBe(within(tabs).getByRole('link', { name: 'Appearance' }));
  });

  it('shows the section tabs for a section with more than one page', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/insights')} />);
    const tabs = await screen.findByTestId('section-tabs');
    expect(tabs).toHaveAttribute('aria-label', 'Tests pages');
    const links = within(tabs).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Tests', 'Quarantine']);
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
      within(screen.getByTestId('nav-bar')).getByRole('link', { name: 'Tests' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('shows the health tabs on the project overview, and none on a detail page', async () => {
    const { unmount } = render(<RouterProvider router={makeRouter('/dashboard')} />);
    const tabs = await screen.findByTestId('section-tabs');
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Portfolio', 'Overview', 'Capabilities', 'Supply chain']);
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
      ).toEqual(['Appearance', 'Projects', 'Reports', 'Quality gates', 'Map', 'Toolbox']),
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

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<RouterProvider router={makeRouter('/dashboard/runner')} />);
    await screen.findByTestId('section-tabs');
    await expectNoBlockingAxeViolations(container);
  });
});
