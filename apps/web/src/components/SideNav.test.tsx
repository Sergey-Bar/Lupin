/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { SideNav } from './SideNav';
import { ThemeProvider } from '../theme/ThemeProvider';
import { PreferencesProvider } from '../theme/preferences';
import { resetViewerRoleCache } from '../hooks/useViewerRole';
import { expectNoBlockingAxeViolations } from '../test-axe';
import { makeApi, makeRun } from '../test-utils';

function renderAt(path: string, api = makeApi({ getRecentRuns: vi.fn(async () => []) })) {
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
    expect(areas).toEqual(['Now', 'Runs', 'Tests', 'Health', 'Delivery']);
    const aside = nav.closest('aside') as HTMLElement;
    const settings = within(aside).getByRole('link', { name: 'Settings' });
    expect(nav.contains(settings)).toBe(false);
    expect(within(aside).queryByTestId('theme-toggle')).toBeNull();
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
    expect(within(nav).getByRole('link', { name: 'Health' })).toHaveAttribute('href', '/dashboard');
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

  it('leads with Ask Lupin, which opens the command palette', async () => {
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    renderAt('/dashboard/now');
    const ask = await screen.findByRole('button', { name: /Ask Lupin/u });
    ask.click();
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ key: 'k', ctrlKey: true }));
    document.removeEventListener('keydown', heard);
  });

  it('lists the five most recent runs, each with its outcome as a dot and a word', async () => {
    const runs = Array.from({ length: 7 }, (_, index) =>
      makeRun({
        id: `${String(index)}`.repeat(8),
        branch: `feat/b-${String(index)}`,
        outcome: index === 0 ? 'failed' : 'passed',
        createdAt: `2026-11-0${String(index + 1)}T10:00:00.000Z`,
      }),
    );
    renderAt('/dashboard/now', makeApi({ getRecentRuns: vi.fn(async () => runs) }));
    const recent = await screen.findByRole('list', { name: 'Recent runs' });
    await within(recent).findByText('feat/b-6');
    const items = within(recent).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('feat/b-6');
    expect(within(recent).getAllByRole('img', { name: /Passed|Failed/u }).length).toBe(5);
  });

  it('tells two runs on one branch apart by suite, or by commit when there is no suite', async () => {
    const runs = [
      makeRun({ id: 'one', branch: 'main', suite: 'checkout e2e' }),
      makeRun({ id: 'two', branch: 'main', suite: null, commit: 'abcdef1234567' }),
    ];
    renderAt('/dashboard/now', makeApi({ getRecentRuns: vi.fn(async () => runs) }));
    const recent = await screen.findByRole('list', { name: 'Recent runs' });
    await within(recent).findByText('checkout e2e');
    const items = within(recent).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('checkout e2e'),
      expect.stringContaining('abcdef1'),
    ]);
    // Exact text: seven characters of the commit, not the whole sha.
    expect(within(items[1] as HTMLElement).getByText('abcdef1')).toBeInTheDocument();
  });

  it('names a run by its branch alone when no other recent run shares it', async () => {
    const runs = [
      makeRun({ id: 'one', branch: 'feat/express-checkout', suite: 'checkout e2e' }),
      makeRun({ id: 'two', branch: 'main', suite: null }),
    ];
    renderAt('/dashboard/now', makeApi({ getRecentRuns: vi.fn(async () => runs) }));
    const recent = await screen.findByRole('list', { name: 'Recent runs' });
    await within(recent).findByText('feat/express-checkout');
    expect(within(recent).queryByText('checkout e2e')).toBeNull();
  });

  it('offers focus mode beside the theme, and shows when it is on', async () => {
    renderAt('/dashboard/now');
    const toggle = await screen.findByRole('button', { name: 'Focus mode' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    toggle.click();
    await waitFor(() => expect(document.documentElement.dataset['focus']).toBe('on'));
    expect(screen.getByRole('button', { name: 'Focus mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    screen.getByRole('button', { name: 'Focus mode' }).click();
    await waitFor(() => expect(document.documentElement.dataset['focus']).toBe('off'));
    localStorage.clear();
  });

  it('lets focus mode put the recent runs away', async () => {
    renderAt('/dashboard/now', makeApi({ getRecentRuns: vi.fn(async () => [makeRun()]) }));
    const recent = await screen.findByRole('list', { name: 'Recent runs' });
    expect(recent.closest('[data-chrome="secondary"]')).not.toBeNull();
  });

  it('says nothing has run yet, rather than drawing an empty box', async () => {
    renderAt('/dashboard/now');
    expect(await screen.findByText('No runs yet')).toBeInTheDocument();
  });
  it('has no serious or critical axe violations', async () => {
    const { container } = renderAt('/dashboard/runs');
    await screen.findByRole('navigation', { name: 'Sidebar' });
    await expectNoBlockingAxeViolations(container);
  });
});
