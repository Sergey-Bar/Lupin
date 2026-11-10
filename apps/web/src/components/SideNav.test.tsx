/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { SIDEBAR_KEY, SideNav } from './SideNav';
import { ThemeProvider } from '../theme/ThemeProvider';
import { PreferencesProvider } from '../theme/preferences';
import { resetViewerRoleCache } from '../hooks/useViewerRole';
import { expectNoBlockingAxeViolations } from '../test-axe';
import { makeApi } from '../test-utils';

function renderAt(path: string, api = makeApi()) {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider>
        <PreferencesProvider>
          <SideNav api={api} />
        </PreferencesProvider>
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
    // Most of this file is about the open sidebar; the rail has its own tests below.
    localStorage.setItem(SIDEBAR_KEY, 'expanded');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is a pyramid: five areas, no sub-tab lists, and Settings pinned at the bottom', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const areas = within(nav)
      .getAllByRole('link')
      .filter((link) => !link.closest('[aria-label="Recent runs"]'))
      .map((link) => link.textContent);
    expect(areas).toEqual(['Home', 'Runs', 'Tests', 'Health']);
    const aside = nav.closest('aside') as HTMLElement;
    const settings = within(aside).getByRole('link', { name: 'Settings' });
    expect(nav.contains(settings)).toBe(false);
    expect(within(aside).queryByTestId('theme-toggle')).toBeNull();
  });

  it('starts as an icon rail, each area named for hover and for a screen reader', async () => {
    localStorage.removeItem(SIDEBAR_KEY);
    renderAt('/dashboard/now');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const aside = nav.closest('aside') as HTMLElement;
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(aside).toHaveClass('w-14');
    const runs = within(nav).getByRole('link', { name: 'Runs' });
    expect(runs).toHaveAttribute('title', 'Runs');
  });

  it('marks the current area with an accent bar on its leading edge, not a grey fill alone', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const runs = within(nav).getByRole('link', { name: 'Runs' });
    expect(runs).toHaveClass('before:start-0', 'before:bg-accent');
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveClass('before:bg-accent');
  });

  it('expands and collapses from one button, and remembers the choice', async () => {
    localStorage.removeItem(SIDEBAR_KEY);
    renderAt('/dashboard/now');
    const toggle = await screen.findByRole('button', { name: 'Expand sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const aside = screen.getByTestId('side-nav');
    expect(aside).toHaveAttribute('data-collapsed', 'false');
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('expanded');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('collapsed');
  });

  it('moves to the next or previous area when the wheel turns over the areas', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    fireEvent.wheel(within(nav).getByRole('link', { name: 'Runs' }), { deltaY: -120 });
    await waitFor(() =>
      expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  });

  it('draws Settings as one icon with a name, not a labelled row', async () => {
    renderAt('/dashboard/now');
    const aside = (await screen.findByRole('navigation', { name: 'Sidebar' })).closest(
      'aside',
    ) as HTMLElement;
    const settings = within(aside).getByRole('link', { name: 'Settings' });
    expect(settings.textContent).toBe('');
    expect(settings).toHaveAttribute('title', 'Settings');
  });

  it('opens an area by its first page', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/dashboard/now',
    );
  });

  it('marks Settings current on any settings page, including the moved Toolbox', async () => {
    renderAt('/dashboard/toolbox');
    const aside = (await screen.findByRole('navigation', { name: 'Sidebar' })).closest(
      'aside',
    ) as HTMLElement;
    expect(within(aside).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
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

  it('carries the wordmark, and no theme control', async () => {
    renderAt('/dashboard/now');
    const aside = (await screen.findByRole('navigation', { name: 'Sidebar' })).closest('aside');
    expect(within(aside as HTMLElement).getByTestId('side-wordmark')).toHaveTextContent('Lupin.');
    expect(within(aside as HTMLElement).queryByTestId('theme-toggle')).toBeNull();
  });

  it('adds no headings, so the page keeps its own outline', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(within(nav).queryAllByRole('heading')).toHaveLength(0);
  });

  it('holds only the areas, Ask Lupin and Settings: no run list and no mode switch', async () => {
    renderAt('/dashboard/now', makeApi());
    const aside = (await screen.findByRole('navigation', { name: 'Sidebar' })).closest(
      'aside',
    ) as HTMLElement;
    expect(within(aside).queryByRole('list', { name: 'Recent runs' })).toBeNull();
    expect(within(aside).queryByRole('button', { name: 'Focus mode' })).toBeNull();
    const names = within(aside)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/sidebar$/u);
    expect(names[1]).toMatch(/^Ask Lupin/u);
  });

  it('leads with Ask Lupin, which opens the command palette', async () => {
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    renderAt('/dashboard/now');
    const ask = await screen.findByRole('button', { name: /Ask Lupin/u });
    ask.click();
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ key: 'k', ctrlKey: true }));
    document.removeEventListener('keydown', heard);
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = renderAt('/dashboard/runs');
    await screen.findByRole('navigation', { name: 'Sidebar' });
    await expectNoBlockingAxeViolations(container);
  });
});
