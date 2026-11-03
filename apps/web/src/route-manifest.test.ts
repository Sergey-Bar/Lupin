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

  it('has six sections, in the order the navigation draws them', () => {
    expect(SECTIONS.map((section) => section.label)).toEqual([
      'Overview',
      'Runs',
      'Insights',
      'Map',
      'GitHub',
      'Settings',
    ]);
    for (const section of SECTIONS) {
      expect(isApplicationPath(section.path), `${section.label} opens nowhere`).toBe(true);
      expect(sectionOf(section.path)).toBe(section.id);
    }
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
      '/dashboard/map',
      '/dashboard/health',
      '/dashboard/supply-chain',
      '/dashboard/toolbox',
      '/dashboard/access',
      '/dashboard/members',
      '/dashboard/audit',
      '/dashboard/deployment',
      '/dashboard/reports',
      '/dashboard/prs',
      '/dashboard/issues',
      '/dashboard/repos',
      '/dashboard/settings',
    ]);
    expect(visibleRoutes.every((route) => isApplicationPath(route.path))).toBe(true);
  });

  it('has no login route: the install is open (ADR-006)', () => {
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
    ['/dashboard', 'overview'],
    ['/dashboard/portfolio', 'overview'],
    ['/dashboard/repo/project-1', 'overview'],
    ['/dashboard/repo/project-1/overview', 'overview'],
    ['/dashboard/delivery', 'insights'],
    ['/dashboard/ai-code', 'insights'],
    ['/dashboard/agents', 'insights'],
    ['/dashboard/supply-chain', 'map'],
    ['/dashboard/runs', 'runs'],
    ['/dashboard/runs/run-1', 'runs'],
    ['/dashboard/runs/run-1/extra', 'runs'],
    ['/dashboard/runner', 'runs'],
    ['/dashboard/insights', 'insights'],
    ['/dashboard/analytics', 'insights'],
    ['/dashboard/quarantine', 'insights'],
    ['/dashboard/gaps/project-1', 'insights'],
    ['/dashboard/score/project-1', 'insights'],
    ['/dashboard/map', 'map'],
    ['/dashboard/health', 'map'],
    ['/dashboard/toolbox', 'map'],
    ['/dashboard/deployment', 'map'],
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

  it('lists each section’s tabs, and the overview leads with the cockpit', () => {
    expect(tabsOf('overview').map((tab) => tab.tab)).toEqual(['Cockpit', 'Portfolio', 'Project']);
    expect(tabsOf('runs').map((tab) => tab.tab)).toEqual(['Runs', 'Launch']);
    expect(tabsOf('insights').map((tab) => tab.tab)).toEqual(['Tests', 'Delivery', 'AI code']);
    expect(tabsOf('map').map((tab) => tab.tab)).toEqual([
      'Map',
      'Capabilities',
      'Supply chain',
      'Toolbox',
      'Access',
      'Members',
      'Audit',
      'Deployment',
      'Reports',
    ]);
    expect(tabsOf('settings').map((tab) => tab.tab)).toEqual([
      'Appearance',
      'Reports',
      'Access',
      'Members',
      'Audit',
      'Deployment',
    ]);
  });

  it('shows a viewer only the Settings tabs they may use, and an admin all of them', () => {
    expect(visibleTabsOf('settings', 'viewer').map((tab) => tab.tab)).toEqual([
      'Appearance',
      'Reports',
    ]);
    expect(visibleTabsOf('settings', null).map((tab) => tab.tab)).toEqual([
      'Appearance',
      'Reports',
    ]);
    expect(visibleTabsOf('settings', 'operator').map((tab) => tab.tab)).toEqual([
      'Appearance',
      'Reports',
    ]);
    expect(visibleTabsOf('settings', 'admin').map((tab) => tab.tab)).toEqual([
      'Appearance',
      'Reports',
      'Access',
      'Members',
      'Audit',
      'Deployment',
    ]);
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
      ['/dashboard', 'overview'],
      ['/dashboard/now', 'overview'],
      ['/dashboard/portfolio', 'overview'],
      ['/dashboard/repo/p-1', 'overview'],
      ['/dashboard/repo/p-1/overview', 'overview'],
      ['/dashboard/runs', 'runs'],
      ['/dashboard/runs/r-1', 'runs'],
      ['/dashboard/runner', 'runs'],
      ['/dashboard/insights', 'insights'],
      ['/dashboard/analytics', 'insights'],
      ['/dashboard/quarantine', 'insights'],
      ['/dashboard/test', 'insights'],
      ['/dashboard/delivery', 'insights'],
      ['/dashboard/ai-code', 'insights'],
      ['/dashboard/agents', 'insights'],
      ['/dashboard/score/p-1', 'insights'],
      ['/dashboard/gaps/p-1', 'insights'],
      ['/dashboard/hollow/p-1', 'insights'],
      ['/dashboard/flaky/p-1', 'insights'],
      ['/dashboard/structure/p-1', 'insights'],
      ['/dashboard/map', 'map'],
      ['/dashboard/health', 'map'],
      ['/dashboard/supply-chain', 'map'],
      ['/dashboard/toolbox', 'map'],
      ['/dashboard/access', 'map'],
      ['/dashboard/members', 'map'],
      ['/dashboard/audit', 'map'],
      ['/dashboard/deployment', 'map'],
      ['/dashboard/reports', 'map'],
      ['/dashboard/pair', 'map'],
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
    expect(sectionOf('/dashboard/metric/coverage')).toBe('overview');
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

  it('has Trends, Quarantine and Agents off the tab rows and the palette, not off the product', () => {
    for (const id of ['analytics', 'quarantine', 'agents']) {
      const entry = routeManifest.find((route) => route.id === id);
      expect(entry, id).toBeDefined();
      expect(entry?.visible, id).toBe(false);
      expect(entry !== undefined && 'tab' in entry, id).toBe(false);
    }
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
    expect(sectionOf(repo360Path('p 1'))).toBe('overview');
  });

  it('recognizes canonical run detail links without accepting arbitrary dashboard paths', () => {
    expect(isApplicationPath(runDetailPath('run 1'))).toBe(true);
    expect(isApplicationPath('/dashboard/runs/run%201?tab=events')).toBe(true);
    expect(isApplicationPath('/dashboard/runs/')).toBe(true);
    expect(isApplicationPath('/dashboard/unknown')).toBe(false);
    expect(isApplicationPath('/ai/agents')).toBe(false);
  });
});
