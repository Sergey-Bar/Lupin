/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NavBar, SectionTabs } from './NavBar';
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

  it('is a narrow icon rail, full height, at every width: the console is desktop only', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    expect(bar).toHaveClass('h-full', 'w-16', 'flex-col');
    expect(bar.className).not.toMatch(/\b(sm|md|lg|xl):/u);
  });

  it('draws the six sections as icons, each a named 44px link with a tooltip', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    const links = within(within(bar).getByRole('list', { name: 'Sections' })).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(SECTION_LABELS);
    for (const link of links) {
      expect(link).toHaveClass('h-11', 'w-11');
      expect(link).toHaveAttribute('title', link.textContent ?? '');
      // The label is for a screen reader only: the rail shows icons.
      expect(link.querySelector('.sr-only')?.textContent).toBe(link.textContent);
    }
  });

  it('is minimal: the sections and the theme, and nothing else', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/insights')} />);
    const bar = await screen.findByTestId('nav-bar');
    expect(within(bar).getAllByRole('link')).toHaveLength(SECTION_LABELS.length);
    expect(within(bar).getAllByRole('button')).toHaveLength(1);
  });

  it('renders the mark once, with the accent dot', async () => {
    render(<RouterProvider router={makeRouter()} />);
    const mark = await screen.findByTestId('nav-wordmark');
    expect(mark).toHaveAttribute('title', 'Lupin');
    expect(screen.getAllByTestId('nav-wordmark')).toHaveLength(1);
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
    const current = within(bar)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });

  it("shows the section's pages as a tab row, with the current page marked", async () => {
    render(<RouterProvider router={makeRouter('/dashboard/insights')} />);
    const tabs = await screen.findByTestId('section-tabs');
    expect(tabs).toHaveAttribute('aria-label', 'Insights pages');
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Tests', 'Delivery', 'AI code']);
    expect(within(tabs).getByRole('link', { name: 'Tests' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows no tab row on a detail page', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/runs/run-1')} />);
    await screen.findByTestId('nav-bar');
    expect(screen.queryByTestId('section-tabs')).toBeNull();
  });

  it('shows the settings tabs a signed-out reader may use, Appearance first', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/settings')} />);
    const tabs = await screen.findByTestId('section-tabs');
    await waitFor(() =>
      expect(
        within(tabs)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Appearance', 'Reports']),
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
    await screen.findByTestId('nav-bar');
    await expectNoBlockingAxeViolations(container);
  });
});
