/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { SideNav } from './SideNav';
import { ThemeProvider } from '../theme/ThemeProvider';
import { SECTIONS, tabsOf } from '../route-manifest';
import { resetViewerRoleCache } from '../hooks/useViewerRole';
import { expectNoBlockingAxeViolations } from '../test-axe';

function renderAt(path: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider>
        <SideNav />
      </ThemeProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: [path] }) });
  return render(<RouterProvider router={router} />);
}

describe('SideNav', () => {
  beforeEach(() => {
    resetViewerRoleCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows every section, and opens only the current one, so the column is never a wall', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    for (const section of SECTIONS) {
      expect(
        within(nav).getAllByText(section.label, { selector: 'a, span' }).length,
      ).toBeGreaterThan(0);
    }
    for (const tab of tabsOf('runs')) {
      expect(within(nav).getAllByRole('link', { name: tab.tab }).length).toBeGreaterThan(0);
    }
    expect(within(nav).queryByRole('link', { name: 'Supply chain' })).toBeNull();
    expect(within(nav).getAllByRole('link').length).toBeLessThanOrEqual(SECTIONS.length + 3);
  });

  it('opens a section by its first page', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(within(nav).getByRole('link', { name: 'Map' })).toHaveAttribute(
      'href',
      '/dashboard/map',
    );
  });
  it('marks the page you are on, by aria-current and not by colour alone', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual(['Runs']);
    expect(current[0]).toHaveClass('font-semibold');
  });

  it('stays in place while the page scrolls, and scrolls its own list when it is long', async () => {
    renderAt('/dashboard/now');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const aside = nav.closest('aside');
    expect(aside).toHaveClass('sticky', 'top-0', 'h-dvh');
    expect(nav).toHaveClass('overflow-y-auto');
  });

  it('is the desktop layout only; below lg the top and bottom bars take over', async () => {
    renderAt('/dashboard/now');
    const aside = (await screen.findByRole('navigation', { name: 'Sidebar' })).closest('aside');
    expect(aside).toHaveClass('hidden', 'lg:flex');
  });

  it('carries the wordmark and the theme control', async () => {
    renderAt('/dashboard/now');
    const aside = (await screen.findByRole('navigation', { name: 'Sidebar' })).closest('aside');
    expect(within(aside as HTMLElement).getByTestId('side-wordmark')).toHaveTextContent('Lupin.');
    expect(within(aside as HTMLElement).getByTestId('theme-toggle')).toBeInTheDocument();
  });

  it('adds no headings, so the page keeps its own outline', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(within(nav).queryAllByRole('heading')).toHaveLength(0);
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = renderAt('/dashboard/runs');
    await screen.findByRole('navigation', { name: 'Sidebar' });
    await expectNoBlockingAxeViolations(container);
  });
});
