import { describe, expect, it } from 'vitest';
import { routeTree } from './router.js';
import {
  SECTIONS,
  isApplicationPath,
  metricPath,
  cockpitPath,
  repo360Path,
  reportPath,
  roleMeets,
  groupOf,
  isOverflowTab,
  navTree,
  tabGroups,
  routeManifest,
  runDetailPath,
  sectionOf,
  tabsOf,
  visibleRoutes,
  visibleTabsOf,
} from './route-manifest.js';

/**
 * Every concrete path the router actually registers.
 *
 * Read from the route tree rather than from a second hand-written list, because a
 * second list is the same defect with a different file. TanStack's `routeTree`
 * exposes the leaves, and a route declared with a path is reachable; one declared
 * without a path is a layout, which is not a navigation target and is not in the
 * manifest either.
 */
function registeredPaths(): string[] {
  const paths: string[] = [];
  const walk = (node: {
    children?: Array<{ isLeaf?: boolean; path?: string; children?: unknown[] }>;
  }) => {
    for (const child of node.children ?? []) {
      if (typeof child.path === 'string') paths.push(child.path);
      walk(child as Parameters<typeof walk>[0]);
    }
  };
  walk(routeTree as unknown as { children?: Array<{ path?: string; children?: unknown[] }> });
  return paths;
}

describe('route manifest', () => {
  it('contains one canonical overview and run list', () => {
    expect(routeManifest.filter((route) => route.path === '/dashboard')).toHaveLength(1);
    expect(routeManifest.some((route) => route.path === '/dashboard/runs')).toBe(true);
  });

  it('has five places, Home, Runs, Tests, Health and Settings, each with at most 4 tabs in view', () => {
    expect(SECTIONS.map((section) => section.label)).toEqual([
      'Home',
      'Runs',
      'Tests',
      'Health',
      'Settings',
    ]);
    for (const section of SECTIONS.filter((entry) => entry.id !== 'settings')) {
      const inView = tabsOf(section.id).filter((tab) => !isOverflowTab(tab));
      expect(
        inView.length,
        `${section.label} shows ${String(inView.length)} tabs`,
      ).toBeLessThanOrEqual(4);
    }
    // Delivery and AI code fold into Health, under "More", and every page still opens.
    expect(sectionOf('/dashboard/prs')).toBe('health');
    expect(sectionOf('/dashboard/ai-code')).toBe('health');
    expect(
      tabsOf('health')
        .filter(isOverflowTab)
        .map((tab) => tab.tab),
    ).toContain('Pull requests');
  });

  it('exposes every old destination, now as a tab of a section', () => {
    expect(visibleRoutes.map((route) => route.path)).toEqual([
      '/dashboard/now',
      '/dashboard/portfolio',
      '/dashboard',
      '/dashboard/runs',
      '/dashboard/runner',
      '/dashboard/insights',
      '/dashboard/delivery',
      '/dashboard/ai-code',
      '/dashboard/agents',
      '/dashboard/health',
      '/dashboard/supply-chain',
      '/dashboard/access',
      '/dashboard/members',
      '/dashboard/audit',
      '/dashboard/deployment',
      '/dashboard/reports',
      '/dashboard/prs',
      '/dashboard/issues',
      '/dashboard/repos',
      '/dashboard/settings',
      '/dashboard/map',
      '/dashboard/toolbox',
    ]);
    expect(visibleRoutes.every((route) => isApplicationPath(route.path))).toBe(true);
  });

  it('reaches every area page from the sidebar, Agents and the old More pages included', () => {
    const health = navTree('admin').find((group) => group.id === 'health');
    const paths = health?.pages.map((page) => page.path) ?? [];
    expect(paths).toContain('/dashboard/agents');
    expect(paths).toContain('/dashboard/prs');
    // Every tab of every place is one entry in the sidebar, for the role that may open it.
    const listed = new Set(navTree('admin').flatMap((group) => group.pages.map((p) => p.path)));
    for (const section of SECTIONS) {
      for (const tab of tabsOf(section.id)) expect(listed.has(tab.path), tab.path).toBe(true);
    }
  });

  it('has no login route: signing in happens on the Access page or at the provider', () => {
    expect(routeManifest.map((route): string => route.path)).not.toContain('/login');
    expect(isApplicationPath('/login')).toBe(false);
  });

  it('puts every routed path in exactly one section', () => {
    for (const route of routeManifest) {
      const matches = SECTIONS.filter((section) => section.id === route.section);
      expect(matches, `${route.path} belongs to ${String(matches.length)} sections`).toHaveLength(
        1,
      );
    }
  });

  it.each([
    ['/dashboard', 'health'],
    ['/dashboard/portfolio', 'health'],
    ['/dashboard/repo/project-1', 'health'],
    ['/dashboard/repo/project-1/overview', 'health'],
    ['/dashboard/delivery', 'health'],
    ['/dashboard/ai-code', 'health'],
    ['/dashboard/agents', 'health'],
    ['/dashboard/supply-chain', 'health'],
    ['/dashboard/runs', 'runs'],
    ['/dashboard/runs/run-1', 'runs'],
    ['/dashboard/runs/run-1/extra', 'runs'],
    ['/dashboard/runner', 'runs'],
    ['/dashboard/insights', 'tests'],
    ['/dashboard/analytics', 'tests'],
    ['/dashboard/quarantine', 'tests'],
    ['/dashboard/gaps/project-1', 'tests'],
    ['/dashboard/score/project-1', 'tests'],
    ['/dashboard/map', 'settings'],
    ['/dashboard/health', 'health'],
    ['/dashboard/toolbox', 'settings'],
    ['/dashboard/deployment', 'settings'],
    ['/dashboard/settings', 'settings'],
    ['/dashboard/settings/reports', 'settings'],
    ['/dashboard/settings/access', 'settings'],
    ['/dashboard/settings/deployment', 'settings'],
  ] as const)('resolves %s to the %s section', (path, section) => {
    expect(sectionOf(path)).toBe(section);
  });

  it('resolves an unknown path to no section, so nothing is marked current by accident', () => {
    expect(sectionOf('/dashboard/unknown')).toBeNull();
    expect(sectionOf('/elsewhere')).toBeNull();
  });

  it('lists each place’s tabs: Home is one page, Runs and Tests two each, Health four and More', () => {
    expect(tabsOf('now')).toEqual([]);
    expect(tabsOf('runs').map((tab) => tab.tab)).toEqual(['Runs', 'Launch']);
    expect(
      tabsOf('health')
        .filter((tab) => !isOverflowTab(tab))
        .map((tab) => tab.tab),
    ).toEqual(['Portfolio', 'Overview', 'Capabilities', 'Supply chain']);
    expect(
      tabsOf('health')
        .filter(isOverflowTab)
        .map((tab) => tab.tab),
    ).toEqual(['Delivery', 'AI code', 'Agents', 'Pull requests', 'Issues', 'Repositories']);
    expect(
      tabGroups(tabsOf('runs')).map((group) => [
        groupOf(group[0] as never),
        group.map((tab) => tab.tab),
      ]),
    ).toEqual([[undefined, ['Runs', 'Launch']]]);
    expect(tabsOf('tests').map((tab) => tab.tab)).toEqual(['Tests', 'Quarantine']);
    expect(tabsOf('settings').map((tab) => tab.tab)).toEqual([
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
    ]);
  });

  it('shows a viewer only the Settings tabs they may use, and an admin all of them', () => {
    expect(visibleTabsOf('settings', 'viewer').map((tab) => tab.tab)).toEqual([
      'Appearance',
      'Projects',
      'Reports',
      'Quality gates',
      'Map',
      'Toolbox',
    ]);
    expect(visibleTabsOf('settings', null).map((tab) => tab.tab)).toEqual([
      'Appearance',
      'Projects',
      'Reports',
      'Quality gates',
      'Map',
      'Toolbox',
    ]);
    expect(visibleTabsOf('settings', 'operator').map((tab) => tab.tab)).toEqual([
      'Appearance',
      'Projects',
      'Reports',
      'Quality gates',
      'Map',
      'Toolbox',
    ]);
    expect(visibleTabsOf('settings', 'admin').map((tab) => tab.tab)).toEqual([
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
    ]);
  });

  it('splits a long tab row into its named groups', () => {
    const groups = tabGroups(visibleTabsOf('settings', 'admin')).map((group) =>
      group.map((tab) => tab.tab),
    );
    expect(groups).toEqual([
      ['Appearance'],
      ['Projects', 'Reports', 'Quality gates', 'Members', 'AI provider', 'Integrations'],
      ['Identity', 'Sessions & retention', 'Access', 'Audit', 'Deployment'],
      ['Map', 'Toolbox'],
    ]);
    expect(tabGroups(tabsOf('runs'))).toHaveLength(1);
  });

  it('names the Settings groups, so the row reads as yours, the workspace, the install and the tools', () => {
    const groups = tabGroups(visibleTabsOf('settings', 'admin'));
    expect(groups.map((group) => (group[0] === undefined ? undefined : groupOf(group[0])))).toEqual(
      ['Personal', 'Workspace', 'Install', 'Tools'],
    );
    expect(groups.map((group) => group.map((tab) => tab.tab))).toEqual([
      ['Appearance'],
      ['Projects', 'Reports', 'Quality gates', 'Members', 'AI provider', 'Integrations'],
      ['Identity', 'Sessions & retention', 'Access', 'Audit', 'Deployment'],
      ['Map', 'Toolbox'],
    ]);
    // A viewer sees the same names over fewer tabs; a group left empty is not drawn.
    expect(
      tabGroups(visibleTabsOf('settings', 'viewer')).map((group) =>
        group[0] === undefined ? undefined : groupOf(group[0]),
      ),
    ).toEqual(['Personal', 'Workspace', 'Tools']);
  });

  it('meets an access floor only at or above it', () => {
    expect(roleMeets(undefined, null)).toBe(true);
    expect(roleMeets('admin', 'viewer')).toBe(false);
    expect(roleMeets('admin', 'operator')).toBe(false);
    expect(roleMeets('admin', 'admin')).toBe(true);
    expect(roleMeets('operator', 'operator')).toBe(true);
    expect(roleMeets('operator', 'viewer')).toBe(false);
  });

  it('registers a path for every manifest entry, so nothing is unreachable', () => {
    // The failure this test used to be unable to catch. `isApplicationPath` is
    // *defined in the module under test*, so checking the manifest against it proves
    // the manifest agrees with itself, and `/dashboard/quarantine` sat in the router
    // while being absent from the manifest — reachable by URL, invisible to the
    // sidebar, and invisible to `isApplicationPath` as well. Nothing failed.
    const registered = new Set(registeredPaths());
    expect(registered.size, 'could not read any route path from the router').toBeGreaterThan(3);

    const applicationPaths = [...registered].filter(isApplicationPath);
    const declared = routeManifest.map((route) => route.path);
    for (const path of applicationPaths) {
      expect(declared, `route ${path} is registered but absent from the manifest`).toContain(path);
    }
    expect(
      [...registered].some((path) => path.replace(/\/$/u, '').endsWith('map')),
      'the map route is not registered',
    ).toBe(true);
  });

  it('still opens every page the product ever had, so no bookmark or old message breaks', () => {
    // Written out, not read from the manifest: a list derived from the thing under test cannot
    // notice that something was removed from it. Trends, Quarantine and Agents left the tab
    // rows when the cockpit arrived, and each must still open the page it always did.
    const EVER_REACHABLE: ReadonlyArray<readonly [path: string, section: string]> = [
      ['/dashboard', 'health'],
      ['/dashboard/now', 'now'],
      ['/dashboard/portfolio', 'health'],
      ['/dashboard/repo/p-1', 'health'],
      ['/dashboard/repo/p-1/overview', 'health'],
      ['/dashboard/runs', 'runs'],
      ['/dashboard/runs/r-1', 'runs'],
      ['/dashboard/runner', 'runs'],
      ['/dashboard/insights', 'tests'],
      ['/dashboard/analytics', 'tests'],
      ['/dashboard/quarantine', 'tests'],
      ['/dashboard/test', 'tests'],
      ['/dashboard/delivery', 'health'],
      ['/dashboard/ai-code', 'health'],
      ['/dashboard/agents', 'health'],
      ['/dashboard/score/p-1', 'tests'],
      ['/dashboard/gaps/p-1', 'tests'],
      ['/dashboard/hollow/p-1', 'tests'],
      ['/dashboard/flaky/p-1', 'tests'],
      ['/dashboard/structure/p-1', 'tests'],
      ['/dashboard/map', 'settings'],
      ['/dashboard/health', 'health'],
      ['/dashboard/supply-chain', 'health'],
      ['/dashboard/toolbox', 'settings'],
      ['/dashboard/access', 'settings'],
      ['/dashboard/members', 'settings'],
      ['/dashboard/audit', 'settings'],
      ['/dashboard/deployment', 'settings'],
      ['/dashboard/reports', 'settings'],
      ['/dashboard/pair', 'settings'],
    ];
    for (const [path, section] of EVER_REACHABLE) {
      expect(isApplicationPath(path), `${path} no longer opens a page`).toBe(true);
      expect(sectionOf(path), `${path} moved sections`).toBe(section);
    }
    // And the router still serves the ones that left the tab rows.
    const registered = registeredPaths().map((path) => path.replace(/^\//u, ''));
    for (const path of ['analytics', 'quarantine', 'agents']) {
      expect(registered, `${path} is no longer routed`).toContain(path);
    }
  });

  it('puts the cockpit metric page in the overview, off the tab row', () => {
    expect(sectionOf('/dashboard/metric/coverage')).toBe('now');
    expect(visibleRoutes.some((route) => route.path.startsWith('/dashboard/metric'))).toBe(false);
    expect(metricPath('flaky-tests')).toBe('/dashboard/metric/flaky-tests');
    expect(metricPath('run-pass-rate', 'release')).toBe(
      '/dashboard/metric/run-pass-rate?window=release',
    );
    expect(metricPath('a b')).toBe('/dashboard/metric/a%20b');
    expect(metricPath('coverage', '7d', 'p 1')).toBe(
      '/dashboard/metric/coverage?window=7d&project=p%201',
    );
    expect(metricPath('coverage', undefined, 'p-1')).toBe('/dashboard/metric/coverage?project=p-1');
    expect(cockpitPath()).toBe('/dashboard/now');
    expect(cockpitPath('p&1')).toBe('/dashboard/now?project=p%261');
  });

  it('builds the report download address for the window shown, with the project encoded', () => {
    expect(reportPath('p-1', '7d')).toBe(
      '/api/v1/projects/p-1/cockpit/report.html?window=7d&download=1',
    );
    expect(reportPath('a/b c', 'release')).toBe(
      '/api/v1/projects/a%2Fb%20c/cockpit/report.html?window=release&download=1',
    );
    // It is an API address, not a page of the app.
    expect(isApplicationPath(reportPath('p-1', '7d'))).toBe(false);
  });

  it('has Trends off the tab rows and the palette, and Agents back on them', () => {
    // Trends is reached from the cockpit's metric pages. Agents went the same way, and then
    // nothing linked to it once the desktop tab row was gone, so it is a Delivery tab again.
    const trends = routeManifest.find((route) => route.id === 'analytics');
    expect(trends?.visible).toBe(false);
    expect(trends !== undefined && 'tab' in trends).toBe(false);
    const agents = routeManifest.find((route) => route.id === 'agents');
    expect(agents?.visible).toBe(true);
    expect(agents !== undefined && 'tab' in agents).toBe(true);
  });

  it('registers the scorecard pages and the 360 in the router', () => {
    const registered = registeredPaths().map((path) => path.replace(/^\//u, ''));
    for (const path of [
      'supply-chain',
      'delivery',
      'ai-code',
      'agents',
      'repo/$projectId/overview',
    ]) {
      expect(registered, `${path} is in the manifest but not the router`).toContain(path);
    }
    expect(repo360Path('p 1')).toBe('/dashboard/repo/p%201/overview');
    expect(sectionOf(repo360Path('p 1'))).toBe('health');
  });

  it('recognizes canonical run detail links without accepting arbitrary dashboard paths', () => {
    expect(isApplicationPath(runDetailPath('run 1'))).toBe(true);
    expect(isApplicationPath('/dashboard/runs/run%201?tab=events')).toBe(true);
    expect(isApplicationPath('/dashboard/runs/')).toBe(true);
    expect(isApplicationPath('/dashboard/unknown')).toBe(false);
    expect(isApplicationPath('/ai/agents')).toBe(false);
  });
});
