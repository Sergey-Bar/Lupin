/// <reference types="vitest/globals" />
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import {
  SIDEBAR_GROUPS_KEY,
  SIDEBAR_KEY,
  SIDEBAR_RETURN_KEY,
  SideNav,
  type ScopeProjects,
} from './SideNav';
import { ThemeProvider } from '../theme/ThemeProvider';
import { PreferencesProvider } from '../theme/preferences';
import { resetViewerRoleCache } from '../hooks/useViewerRole';
import { publishRuns, resetLatestRuns } from '../hooks/useRuns';
import { expectNoBlockingAxeViolations } from '../test-axe';
import { makeApi, makeRun } from '../test-utils';
import type { Onboarding } from '@lupin/shared-contracts';

function renderAt(
  path: string,
  api = makeApi(),
  onboarding: () => Promise<Onboarding> = async () => Promise.reject(new Error('unread')),
  projects: ScopeProjects = async () => Promise.reject(new Error('unread')),
) {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider>
        <PreferencesProvider>
          <SideNav api={api} onboarding={onboarding} projects={projects} />
        </PreferencesProvider>
      </ThemeProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: [path] }) });
  return { ...render(<RouterProvider router={router} />), router };
}

/** The viewer's role, answered by the who-am-I endpoint the role hook reads. */
function signedInAs(role: 'viewer' | 'operator' | 'admin') {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ actor: 'you', role, mode: 'enforced' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

describe('SideNav, app mode', () => {
  beforeEach(() => {
    resetViewerRoleCache();
    resetLatestRuns();
    localStorage.clear();
    localStorage.setItem(SIDEBAR_KEY, 'expanded');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the four places, and keeps Settings out of the list, pinned below it', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const places = [...nav.querySelectorAll('[data-place]')].map((place) =>
      place.getAttribute('data-place'),
    );
    expect(places).toEqual(['now', 'runs', 'tests', 'health']);
    // A place with one page is that page: a link, with nothing to open.
    const home = within(nav).getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('data-place', 'now');
    expect(home).toHaveAttribute('href', '/dashboard/now');
    expect(home).not.toHaveAttribute('aria-expanded');
    const aside = nav.closest('aside') as HTMLElement;
    const settings = within(aside).getByRole('link', { name: 'Settings' });
    expect(nav.contains(settings)).toBe(false);
    expect(within(aside).queryByTestId('theme-toggle')).toBeNull();
  });

  // A failed role read hid the admin pages and said nothing (ledger MNT-187).
  it.each(['expanded', 'collapsed'])(
    'says, on the %s sidebar, that the role could not be read, and retries',
    async (width) => {
      localStorage.setItem(SIDEBAR_KEY, width);
      let up = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          up
            ? new Response(JSON.stringify({ actor: 'you', role: 'admin', mode: 'enforced' }), {
                status: 200,
              })
            : new Response('down', { status: 503 }),
        ),
      );
      renderAt('/dashboard/runs');
      const retry = await screen.findByRole('button', { name: /role could not be read/iu });
      up = true;
      fireEvent.click(retry);
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /role could not be read/iu })).toBeNull(),
      );
    },
  );

  it('says nothing when the caller is simply signed out', async () => {
    renderAt('/dashboard/runs');
    await screen.findByRole('navigation', { name: 'Sidebar' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole('button', { name: /role could not be read/iu })).toBeNull();
  });

  it('marks Home as the page you are on when you are on it', async () => {
    renderAt('/dashboard/now');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('follows Home in one click, with no list to open first', async () => {
    const { router } = renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Home' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard/now'));
  });

  it('counts on the Runs group what the Runs page asks of you, and says it in words', async () => {
    const api = makeApi({
      getRuns: vi.fn(async () => [
        makeRun({ id: 'a', branch: 'main', phase: 'complete', outcome: 'failed' }),
        makeRun({ id: 'b', branch: 'release', phase: 'complete', outcome: 'blocked' }),
        makeRun({ id: 'c', branch: 'docs', phase: 'complete', outcome: 'passed' }),
      ]),
    });
    renderAt('/dashboard/now', api);
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const runs = await within(nav).findByRole('button', { name: 'Runs, 2 need you' });
    expect(within(runs).getByTestId('place-count')).toHaveTextContent('2');
    expect(within(nav).getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });

  it('on Runs, counts from the list the page already read rather than fetching it again', async () => {
    const api = makeApi();
    renderAt('/dashboard/runs', api);
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    act(() =>
      publishRuns([makeRun({ id: 'a', branch: 'main', phase: 'complete', outcome: 'failed' })]),
    );
    expect(
      await within(nav).findByRole('button', { name: 'Runs, 1 needs you' }),
    ).toBeInTheDocument();
    expect(api.getRuns).not.toHaveBeenCalled();
  });

  it('shows no count when nothing needs you, and keeps the plain name', async () => {
    const api = makeApi({
      getRuns: vi.fn(async () => [
        makeRun({ id: 'a', branch: 'main', phase: 'complete', outcome: 'passed' }),
      ]),
    });
    renderAt('/dashboard/now', api);
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    await waitFor(() => expect(api.getRuns).toHaveBeenCalled());
    expect(within(nav).getByRole('button', { name: 'Runs' })).toBeInTheDocument();
    expect(within(nav).queryByTestId('place-count')).toBeNull();
  });

  it('keeps the count as a dot on the collapsed rail, still named in words', async () => {
    localStorage.setItem(SIDEBAR_KEY, 'collapsed');
    const api = makeApi({
      getRuns: vi.fn(async () => [
        makeRun({ id: 'a', branch: 'main', phase: 'complete', outcome: 'failed' }),
      ]),
    });
    renderAt('/dashboard/now', api);
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const runs = await within(nav).findByRole('button', { name: 'Runs, 1 needs you' });
    expect(within(runs).getByTestId('place-count')).toHaveAttribute('aria-hidden', 'true');
  });

  it('offers "Finish setup" with how far it got, until setup is done or dismissed', async () => {
    const left = {
      steps: [],
      done: 2,
      total: 6,
      dismissed: false,
    };
    const { unmount } = renderAt('/dashboard/now', makeApi(), async () => left);
    const chip = await screen.findByRole('link', { name: 'Finish setup, 2 of 6 done' });
    expect(chip).toHaveAttribute('href', '/dashboard/setup');
    expect(chip).toHaveTextContent('Finish setup · 2 of 6');
    unmount();
    renderAt('/dashboard/now', makeApi(), async () => ({ ...left, done: 6 }));
    await screen.findByRole('navigation', { name: 'Sidebar' });
    await waitFor(() => expect(screen.queryByRole('link', { name: /Finish setup/u })).toBeNull());
  });

  it('opens the group of the page you are on, with every page of that place in it', async () => {
    renderAt('/dashboard/prs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const health = within(nav).getByRole('button', { name: 'Health' });
    expect(health).toHaveAttribute('aria-expanded', 'true');
    const pages = within(screen.getByRole('list', { name: 'Health pages' }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    // Every Health page, the ones the old "More" menu held included.
    expect(pages).toEqual(expect.arrayContaining(['Overview', 'Supply chain', 'Pull requests']));
    expect(within(nav).getByRole('button', { name: 'Runs' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens and closes a group on a click, and remembers what is open', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const tests = within(nav).getByRole('button', { name: 'Tests' });
    fireEvent.click(tests);
    expect(tests).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem(SIDEBAR_GROUPS_KEY) ?? '[]')).toContain('tests');
    fireEvent.click(tests);
    expect(tests).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens what it remembered on the next visit, and ignores a list that is not names', async () => {
    localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(['tests']));
    const first = renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(within(nav).getByRole('button', { name: 'Tests' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    first.unmount();
    localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(['tests', 3]));
    renderAt('/dashboard/runs');
    const again = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(within(again).getByRole('button', { name: 'Tests' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('marks the page you are on, by aria-current and an accent bar, not by colour alone', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual(['All runs']);
    expect(current[0]).toHaveClass('font-semibold', 'before:start-0', 'before:bg-accent');
  });

  it('opens a group at its first page from the group itself', async () => {
    renderAt('/dashboard/now');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Runs' }));
    expect(
      within(screen.getByRole('list', { name: 'Runs pages' })).getAllByRole('link')[0],
    ).toHaveAttribute('href', '/dashboard/runs');
  });

  it('moves between the pages it lists with the arrow keys', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const runs = within(nav).getByRole('link', { name: 'All runs' });
    runs.focus();
    fireEvent.keyDown(runs, { key: 'ArrowDown' });
    expect(document.activeElement).not.toBe(runs);
    expect(nav.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(runs);
  });

  it('starts as an icon rail, each place named for hover and for a screen reader', async () => {
    localStorage.removeItem(SIDEBAR_KEY);
    renderAt('/dashboard/now');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const aside = nav.closest('aside') as HTMLElement;
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(aside).toHaveClass('w-14');
    expect(within(nav).getByRole('button', { name: 'Runs' })).toHaveAttribute('title', 'Runs');
  });

  it('opens a place as a flyout from the rail, and closes it on Escape', async () => {
    localStorage.removeItem(SIDEBAR_KEY);
    renderAt('/dashboard/now');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Health' }));
    const flyout = await screen.findByRole('list', { name: 'Health pages' });
    expect(within(flyout).getAllByRole('link').length).toBeGreaterThan(3);
    fireEvent.keyDown(flyout, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Health pages' })).toBeNull());
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

  it('draws Settings as one icon with a name, not a labelled row', async () => {
    renderAt('/dashboard/now');
    const aside = await screen.findByTestId('side-nav');
    const settings = await within(aside).findByRole('link', { name: 'Settings' });
    expect(settings.textContent).toBe('');
    expect(settings).toHaveAttribute('title', 'Settings');
  });

  it('stays in place while the page scrolls, and scrolls its own list when it is long', async () => {
    renderAt('/dashboard/now');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(nav.closest('aside')).toHaveClass('sticky', 'top-0', 'h-dvh');
    expect(nav).toHaveClass('overflow-y-auto');
  });

  it('is the desktop layout only; below lg the top bar and its drawer take over', async () => {
    renderAt('/dashboard/now');
    expect(await screen.findByTestId('side-nav')).toHaveClass('hidden', 'lg:flex');
  });

  it('carries the wordmark, and no theme control', async () => {
    renderAt('/dashboard/now');
    const aside = await screen.findByTestId('side-nav');
    expect(within(aside).getByTestId('side-wordmark')).toHaveTextContent('Lupin.');
    expect(within(aside).queryByTestId('theme-toggle')).toBeNull();
  });

  it('adds no headings, so the page keeps its own outline', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(within(nav).queryAllByRole('heading')).toHaveLength(0);
  });

  it('holds no run list and no mode switch', async () => {
    renderAt('/dashboard/now', makeApi());
    const aside = await screen.findByTestId('side-nav');
    expect(within(aside).queryByRole('list', { name: 'Recent runs' })).toBeNull();
    expect(within(aside).queryByRole('button', { name: 'Focus mode' })).toBeNull();
  });

  it('leads with Ask Lupin, which opens the command palette', async () => {
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    renderAt('/dashboard/now');
    (await screen.findByRole('button', { name: /Ask Lupin/u })).click();
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ key: 'k', ctrlKey: true }));
    document.removeEventListener('keydown', heard);
  });

  it('jumps to the first and last page with Home and End, and ignores other keys', async () => {
    renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    const runs = within(nav).getByRole('link', { name: 'All runs' });
    runs.focus();
    fireEvent.keyDown(runs, { key: 'Home' });
    expect(document.activeElement).toBe(within(nav).getByRole('link', { name: 'Home' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(within(nav).getByRole('button', { name: 'Health' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'x' });
    expect(document.activeElement).toBe(within(nav).getByRole('button', { name: 'Health' }));
  });

  it('follows a page from the rail flyout, and closes the flyout as it goes', async () => {
    localStorage.removeItem(SIDEBAR_KEY);
    const { router } = renderAt('/dashboard/now');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Runs' }));
    const flyout = await screen.findByRole('list', { name: 'Runs pages' });
    fireEvent.click(within(flyout).getAllByRole('link')[0] as HTMLElement);
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard/runs'));
    expect(screen.queryByRole('list', { name: 'Runs pages' })).toBeNull();
  });

  it('opens with nothing remembered when the stored groups are not a list, or not JSON', async () => {
    localStorage.setItem(SIDEBAR_GROUPS_KEY, '{"not":"a list"}');
    const first = renderAt('/dashboard/runs');
    const nav = await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(within(nav).getByRole('button', { name: 'Tests' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    first.unmount();
    localStorage.setItem(SIDEBAR_GROUPS_KEY, 'not json');
    renderAt('/dashboard/runs');
    expect(
      within(await screen.findByRole('navigation', { name: 'Sidebar' })).getByRole('button', {
        name: 'Tests',
      }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('still works when storage refuses every read and write', async () => {
    const first = renderAt('/dashboard/now');
    await screen.findByRole('navigation', { name: 'Sidebar' });
    first.unmount();
    // Only the sidebar's keys refuse: the router keeps its own storage working.
    const ours = new Set([SIDEBAR_KEY, SIDEBAR_GROUPS_KEY, SIDEBAR_RETURN_KEY]);
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (ours.has(key)) throw new Error('denied');
      return realGet.call(this, key);
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (ours.has(key)) throw new Error('denied');
      realSet.call(this, key, value);
    });
    try {
      renderAt('/dashboard/runs');
      const again = await screen.findByRole('navigation', { name: 'Sidebar' });
      // A refused storage is the rail, and opening a place still works for this page.
      expect(screen.getByTestId('side-nav')).toHaveAttribute('data-collapsed', 'true');
      fireEvent.click(within(again).getByRole('button', { name: 'Tests' }));
      expect(await screen.findByRole('list', { name: 'Tests pages' })).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('has no serious or critical axe violations, open or as a rail', async () => {
    const { container, unmount } = renderAt('/dashboard/runs');
    await screen.findByRole('navigation', { name: 'Sidebar' });
    await expectNoBlockingAxeViolations(container);
    unmount();
    localStorage.removeItem(SIDEBAR_KEY);
    const rail = renderAt('/dashboard/runs');
    await screen.findByRole('navigation', { name: 'Sidebar' });
    await expectNoBlockingAxeViolations(rail.container);
  });
});

describe('SideNav, Settings mode', () => {
  beforeEach(() => {
    resetViewerRoleCache();
    resetLatestRuns();
    localStorage.clear();
    localStorage.setItem(SIDEBAR_KEY, 'expanded');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('swaps to the Settings list on any settings page, the moved Toolbox included', async () => {
    signedInAs('admin');
    renderAt('/dashboard/toolbox');
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    await within(nav).findByRole('list', { name: 'Install' });
    expect(within(nav).getByRole('link', { name: 'Toolbox' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const groups = within(nav)
      .getAllByRole('list')
      .map((list) => list.getAttribute('aria-label'));
    expect(groups).toEqual(['Personal', 'Workspace', 'Install', 'Tools']);
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).toBeNull();
  });

  it('lists only what the role may open', async () => {
    signedInAs('viewer');
    renderAt('/dashboard/settings');
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByRole('link', { name: 'Appearance' })).toBeInTheDocument();
    await waitFor(() => expect(within(nav).queryByRole('link', { name: 'Members' })).toBeNull());
  });

  it('goes back to the page you were on before Settings', async () => {
    signedInAs('admin');
    const { router } = renderAt('/dashboard/insights');
    await screen.findByRole('navigation', { name: 'Sidebar' });
    expect(localStorage.getItem(SIDEBAR_RETURN_KEY)).toBe('/dashboard/insights');
    await router.navigate({ to: '/dashboard/settings' });
    const back = await screen.findByRole('link', { name: /Back to Lupin/u });
    expect(back).toHaveAttribute('href', '/dashboard/insights');
  });

  it('goes back to Home when there is nowhere remembered', async () => {
    signedInAs('admin');
    renderAt('/dashboard/settings');
    expect(await screen.findByRole('link', { name: /Back to Lupin/u })).toHaveAttribute(
      'href',
      '/dashboard/now',
    );
  });

  it('has no serious or critical axe violations', async () => {
    signedInAs('admin');
    const { container } = renderAt('/dashboard/settings/projects');
    await screen.findByRole('navigation', { name: 'Settings' });
    await expectNoBlockingAxeViolations(container);
  });
});

describe('SideNav, the project scope', () => {
  const TWO: ScopeProjects = async () => [
    { id: 'p-1', name: 'Shop' },
    { id: 'p-2', name: 'Website' },
  ];
  beforeEach(() => {
    resetViewerRoleCache();
    resetLatestRuns();
    localStorage.clear();
    localStorage.setItem(SIDEBAR_KEY, 'expanded');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('offers every project and each one, and is not drawn for one project or a failed read', async () => {
    const view = renderAt('/dashboard/now', makeApi(), undefined, TWO);
    const select = await screen.findByLabelText('Project scope');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All projects', 'Shop', 'Website']);
    expect(select).toHaveValue('');
    view.unmount();
    renderAt('/dashboard/now', makeApi(), undefined, async () => [{ id: 'p-1', name: 'Shop' }]);
    await screen.findByRole('navigation', { name: 'Sidebar' });
    await act(async () => Promise.resolve());
    expect(screen.queryByLabelText('Project scope')).toBeNull();
  });

  it('keeps the scope on every link to a page that reads it, and off the rest', async () => {
    renderAt('/dashboard/now', makeApi(), undefined, TWO);
    fireEvent.change(await screen.findByLabelText('Project scope'), { target: { value: 'p-2' } });
    const nav = screen.getByRole('navigation', { name: 'Sidebar' });
    await waitFor(() =>
      expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute(
        'href',
        '/dashboard/now?project=p-2',
      ),
    );
    fireEvent.click(within(nav).getByRole('button', { name: 'Runs' }));
    const runsPages = await screen.findByRole('list', { name: 'Runs pages' });
    for (const link of within(runsPages).getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toContain('project=');
    }
    fireEvent.click(within(nav).getByRole('button', { name: 'Health' }));
    const healthPages = await screen.findByRole('list', { name: 'Health pages' });
    expect(within(healthPages).getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
      'href',
      '/dashboard/prs?project=p-2',
    );
    expect(localStorage.getItem('lupin-project')).toBe('p-2');
  });

  it('names the scope on the icon rail, and opens the column to change it', async () => {
    localStorage.setItem(SIDEBAR_KEY, 'collapsed');
    localStorage.setItem('lupin-project', 'p-2');
    renderAt('/dashboard/runs', makeApi(), undefined, TWO);
    const rail = await screen.findByRole('button', {
      name: 'Project scope: Website. Open the sidebar to change it',
    });
    expect(screen.queryByLabelText('Project scope')).toBeNull();
    fireEvent.click(rail);
    expect(await screen.findByLabelText('Project scope')).toHaveValue('p-2');
  });

  it('rewrites the address of a page that reads the scope, and leaves another page’s alone', async () => {
    const { router } = renderAt('/dashboard/prs', makeApi(), undefined, TWO);
    fireEvent.change(await screen.findByLabelText('Project scope'), { target: { value: 'p-1' } });
    await waitFor(() =>
      expect(router.state.location.search).toEqual(expect.objectContaining({ project: 'p-1' })),
    );
    fireEvent.change(screen.getByLabelText('Project scope'), { target: { value: '' } });
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('project'));
    const runs = renderAt('/dashboard/runs', makeApi(), undefined, TWO);
    const selects = await screen.findAllByLabelText('Project scope');
    fireEvent.change(selects.at(-1) as HTMLElement, { target: { value: 'p-2' } });
    await waitFor(() => expect(localStorage.getItem('lupin-project')).toBe('p-2'));
    expect(runs.router.state.location.pathname).toBe('/dashboard/runs');
    expect(runs.router.state.location.search).not.toHaveProperty('project');
  });

  it('opens on the project a link names, and remembers it', async () => {
    renderAt('/dashboard/prs?project=p-2', makeApi(), undefined, TWO);
    expect(await screen.findByLabelText('Project scope')).toHaveValue('p-2');
    await waitFor(() => expect(localStorage.getItem('lupin-project')).toBe('p-2'));
  });

  it('reads a remembered project that is no longer registered as every project', async () => {
    localStorage.setItem('lupin-project', 'gone');
    renderAt('/dashboard/now', makeApi(), undefined, TWO);
    expect(await screen.findByLabelText('Project scope')).toHaveValue('');
  });
});
