/**
 * Every navigable page, and the section it belongs to.
 *
 * ## Four areas, then Settings
 *
 * Home (the release verdict and what needs you), Runs, Tests and Health are the areas a
 * reader works in; Delivery, AI code and Agents sit under Health. Everything an admin
 * configures, or opens rarely, is under Settings. Every old URL
 * is still a page: `section` only decides where it sits, and `route-manifest.test.ts` pins
 * every path.
 *
 * `label` is the page's own name (the palette says "Go to Trends"); `tab` is the short
 * label on its section's tab row. A page with no `tab` is a detail page — reachable from
 * a link, never from the tab row.
 *
 * ## The cockpit, and the pages that became its detail
 *
 * The product answers one question — is it better or worse than before, and why — on the
 * cockpit, and a metric's page (`/dashboard/metric/:metricId`) is where a QA engineer goes
 * one level down. Trends, Quarantine and Agents therefore left the tab rows: Trends and
 * Quarantine are now reached from the metric they explain (the run pass rate and the flaky
 * tests), and Agents does not feed the cockpit. They are still routed, still in this
 * manifest and still open the same page, so a bookmark or a link from an old message keeps
 * working; `route-manifest.test.ts` pins every old path.
 */
export const SECTIONS = [
  { id: 'now', label: 'Home', path: '/dashboard/now' },
  { id: 'runs', label: 'Runs', path: '/dashboard/runs' },
  { id: 'tests', label: 'Tests', path: '/dashboard/insights' },
  { id: 'health', label: 'Health', path: '/dashboard' },
  { id: 'settings', label: 'Settings', path: '/dashboard/settings' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** The least role a tab needs; absent means everyone, matching the API's own guard. */
export type TabAccess = 'operator' | 'admin';

interface ManifestEntry {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly visible: boolean;
  readonly section: SectionId;
  readonly tab?: string;
  /** The named group a tab sits in on a long tab row (Settings): Personal, Workspace, … */
  readonly group?: string;
  /** Drawn in the tab row's "More" menu rather than as a tab: a place shows at most four. */
  readonly overflow?: boolean;
  readonly access?: TabAccess;
}

export const routeManifest = [
  {
    id: 'now',
    path: '/dashboard/now',
    label: 'Dashboard',
    visible: true,
    section: 'now',
    tab: 'Now',
  },
  // First-run setup: a guided flow, reached from the cockpit and the checklist, never a tab.
  {
    id: 'setup',
    path: '/dashboard/setup',
    label: 'Set up Lupin',
    visible: false,
    section: 'now',
  },
  {
    id: 'metric',
    path: '/dashboard/metric/:metricId',
    label: 'Metric',
    visible: false,
    section: 'now',
  },
  // The briefing in full, reached from Home's card; `?project=` narrows it to one repository.
  {
    id: 'briefing',
    path: '/dashboard/briefing',
    label: 'Briefing',
    visible: false,
    section: 'now',
  },
  {
    id: 'portfolio',
    path: '/dashboard/portfolio',
    label: 'Portfolio',
    visible: true,
    section: 'health',
    tab: 'Portfolio',
  },
  {
    id: 'dashboard',
    path: '/dashboard',
    label: 'Overview',
    visible: true,
    section: 'health',
    tab: 'Overview',
  },
  {
    id: 'repo-health',
    path: '/dashboard/repo/:projectId',
    label: 'Repository Health',
    visible: false,
    section: 'health',
  },
  {
    id: 'repo-360',
    path: '/dashboard/repo/:projectId/overview',
    label: 'Repository 360',
    visible: false,
    section: 'health',
  },
  {
    id: 'runs',
    path: '/dashboard/runs',
    label: 'Runs',
    visible: true,
    section: 'runs',
    tab: 'Runs',
  },
  {
    id: 'run-detail',
    path: '/dashboard/runs/:runId',
    label: 'Run detail',
    visible: false,
    section: 'runs',
  },
  {
    id: 'runner',
    path: '/dashboard/runner',
    label: 'Launch',
    visible: true,
    section: 'runs',
    tab: 'Launch',
  },
  {
    id: 'insights',
    path: '/dashboard/insights',
    label: 'Insights',
    visible: true,
    section: 'tests',
    tab: 'Tests',
  },
  {
    id: 'analytics',
    path: '/dashboard/analytics',
    label: 'Trends',
    visible: false,
    section: 'tests',
  },
  {
    id: 'quarantine',
    path: '/dashboard/quarantine',
    label: 'Quarantine',
    visible: false,
    section: 'tests',
    tab: 'Quarantine',
  },
  {
    id: 'test-history',
    path: '/dashboard/test',
    label: 'Test History',
    visible: false,
    section: 'tests',
  },
  {
    id: 'delivery',
    path: '/dashboard/delivery',
    label: 'Delivery',
    visible: true,
    section: 'health',
    tab: 'Delivery',
    overflow: true,
  },
  {
    id: 'ai-code',
    path: '/dashboard/ai-code',
    label: 'AI code',
    visible: true,
    section: 'health',
    tab: 'AI code',
    overflow: true,
  },
  {
    id: 'agents',
    path: '/dashboard/agents',
    label: 'Agents',
    // A tab again: with the tab row gone from desktop and no tab here, nothing linked to it
    // but a card deep in Repository 360.
    visible: true,
    section: 'health',
    tab: 'Agents',
    overflow: true,
  },
  {
    id: 'score',
    path: '/dashboard/score/:projectId',
    label: 'Health Score',
    visible: false,
    section: 'tests',
  },
  {
    id: 'gaps',
    path: '/dashboard/gaps/:projectId',
    label: 'Automation Gaps',
    visible: false,
    section: 'tests',
  },
  {
    id: 'hollow',
    path: '/dashboard/hollow/:projectId',
    label: 'Hollow Tests',
    visible: false,
    section: 'tests',
  },
  {
    id: 'flaky',
    path: '/dashboard/flaky/:projectId',
    label: 'Flaky Tests',
    visible: false,
    section: 'tests',
  },
  {
    id: 'structure',
    path: '/dashboard/structure/:projectId',
    label: 'Structural Findings',
    visible: false,
    section: 'tests',
  },
  {
    id: 'health',
    path: '/dashboard/health',
    label: 'Capabilities',
    visible: true,
    section: 'health',
    tab: 'Capabilities',
  },
  {
    id: 'supply-chain',
    path: '/dashboard/supply-chain',
    label: 'Supply chain',
    visible: true,
    section: 'health',
    tab: 'Supply chain',
  },
  {
    id: 'access',
    path: '/dashboard/access',
    label: 'Access',
    visible: true,
    section: 'settings',
  },
  {
    id: 'members',
    path: '/dashboard/members',
    label: 'Members',
    visible: true,
    section: 'settings',
  },
  {
    id: 'audit',
    path: '/dashboard/audit',
    label: 'Audit trail',
    visible: true,
    section: 'settings',
  },
  {
    id: 'deployment',
    path: '/dashboard/deployment',
    label: 'Deployment',
    visible: true,
    section: 'settings',
  },
  {
    id: 'reports',
    path: '/dashboard/reports',
    label: 'Reports',
    visible: true,
    section: 'settings',
  },
  {
    id: 'prs',
    path: '/dashboard/prs',
    label: 'Pull requests',
    visible: true,
    section: 'health',
    tab: 'Pull requests',
    overflow: true,
  },
  // One pull request's change risk, reached from its row, Home and the check run's link.
  {
    id: 'pr-risk',
    path: '/dashboard/prs/:projectId/:number',
    label: 'Pull request risk',
    visible: false,
    section: 'health',
  },
  {
    id: 'issues',
    path: '/dashboard/issues',
    label: 'Issues',
    visible: true,
    section: 'health',
    tab: 'Issues',
    overflow: true,
  },
  {
    id: 'repos',
    path: '/dashboard/repos',
    label: 'Repositories',
    visible: true,
    section: 'health',
    tab: 'Repositories',
    overflow: true,
  },
  {
    id: 'repo-detail',
    path: '/dashboard/repos/:projectId',
    label: 'Repository',
    visible: false,
    section: 'health',
  },
  {
    id: 'pair',
    path: '/dashboard/pair',
    label: 'Pair this device',
    visible: false,
    section: 'settings',
  },
  // Settings — the one place a reader changes how the product behaves. The landing is
  // Appearance (the one visible entry, so the section appears once in the nav and the
  // palette); the other tabs reuse the admin and report surfaces under `settings/*` and
  // stay out of the palette (`visible: false`) while still drawing the section's tab row.
  //
  // The tab row reads workspace first (what this team owns), then installation (what the
  // whole install shares). Appearance leads because it is the landing, and the one tab every
  // reader, signed in or not, may use.
  {
    id: 'settings-appearance',
    path: '/dashboard/settings',
    label: 'Settings',
    visible: true,
    section: 'settings',
    tab: 'Appearance',
    group: 'Personal',
  },
  {
    id: 'settings-projects',
    path: '/dashboard/settings/projects',
    label: 'Project settings',
    visible: false,
    section: 'settings',
    tab: 'Projects',
    group: 'Workspace',
  },
  {
    id: 'settings-reports',
    path: '/dashboard/settings/reports',
    label: 'Report settings',
    visible: false,
    section: 'settings',
    tab: 'Reports',
    group: 'Workspace',
  },
  {
    id: 'settings-quality-gates',
    path: '/dashboard/settings/quality-gates',
    label: 'Quality gate settings',
    visible: false,
    section: 'settings',
    tab: 'Quality gates',
    group: 'Workspace',
  },
  {
    id: 'settings-members',
    path: '/dashboard/settings/members',
    label: 'Member settings',
    visible: false,
    section: 'settings',
    tab: 'Members',
    group: 'Workspace',
    access: 'admin',
  },
  {
    id: 'settings-ai',
    path: '/dashboard/settings/ai',
    label: 'AI provider settings',
    visible: false,
    section: 'settings',
    tab: 'AI provider',
    group: 'Workspace',
    access: 'admin',
  },
  {
    id: 'settings-integrations',
    path: '/dashboard/settings/integrations',
    label: 'Integration settings',
    visible: false,
    section: 'settings',
    tab: 'Integrations',
    group: 'Workspace',
    access: 'admin',
  },
  {
    id: 'settings-identity',
    path: '/dashboard/settings/identity',
    label: 'Identity settings',
    visible: false,
    section: 'settings',
    tab: 'Identity',
    group: 'Install',
    access: 'admin',
  },
  {
    id: 'settings-sessions',
    path: '/dashboard/settings/sessions',
    label: 'Session and retention settings',
    visible: false,
    section: 'settings',
    tab: 'Sessions & retention',
    group: 'Install',
    access: 'admin',
  },
  {
    id: 'settings-access',
    path: '/dashboard/settings/access',
    label: 'Access settings',
    visible: false,
    section: 'settings',
    tab: 'Access',
    group: 'Install',
    access: 'admin',
  },
  {
    id: 'settings-audit',
    path: '/dashboard/settings/audit',
    label: 'Audit settings',
    visible: false,
    section: 'settings',
    tab: 'Audit',
    group: 'Install',
    access: 'admin',
  },
  {
    id: 'settings-deployment',
    path: '/dashboard/settings/deployment',
    label: 'Deployment settings',
    visible: false,
    section: 'settings',
    tab: 'Deployment',
    group: 'Install',
    access: 'admin',
  },
  {
    id: 'map',
    path: '/dashboard/map',
    label: 'Map',
    visible: true,
    section: 'settings',
    tab: 'Map',
    group: 'Tools',
  },
  {
    id: 'toolbox',
    path: '/dashboard/toolbox',
    label: 'Toolbox',
    visible: true,
    section: 'settings',
    tab: 'Toolbox',
    group: 'Tools',
  },
] as const satisfies readonly ManifestEntry[];

export type ManifestRoute = (typeof routeManifest)[number];

export const visibleRoutes = routeManifest.filter((route) => route.visible);

function normalise(path: string): string {
  return path.split(/[?#]/u, 1)[0]?.replace(/\/$/u, '') || '/';
}

/** Whether `path` matches a manifest pattern, where a `:param` segment matches one segment. */
function matches(pattern: string, path: string): boolean {
  const want = pattern.split('/');
  const have = path.split('/');
  if (want.length !== have.length) return false;
  return want.every(
    (segment, index) =>
      segment === have[index] || (segment.startsWith(':') && (have[index] ?? '').length > 0),
  );
}

/** The manifest entry `path` opens, or `undefined`. */
export function routeFor(path: string): ManifestRoute | undefined {
  const normalized = normalise(path);
  return routeManifest.find((route) => matches(route.path, normalized));
}

export function isApplicationPath(path: string): boolean {
  const normalized = normalise(path);
  // `/dashboard/runs/` normalises to the list; anything under it is a run detail.
  return (
    routeFor(normalized) !== undefined ||
    (normalized.startsWith('/dashboard/runs/') && normalized.length > '/dashboard/runs/'.length)
  );
}

/** The section `path` sits in, or `null` for a path that is not a page. */
export function sectionOf(path: string): SectionId | null {
  const section = routeFor(path)?.section;
  if (section !== undefined) return section;
  // Anything under a run is that run's page, even a sub-path the manifest does not name.
  return isApplicationPath(path) && normalise(path).startsWith('/dashboard/runs/') ? 'runs' : null;
}

/** A page that has a place on its section's tab row. */
export type TabRoute = Extract<ManifestRoute, { tab: string }>;

/** A section's tab row, in manifest order. Empty for a one-page section. */
export function tabsOf(section: SectionId): TabRoute[] {
  const tabs = routeManifest.filter(
    (route): route is TabRoute => route.section === section && 'tab' in route,
  );
  return tabs.length > 1 ? tabs : [];
}

/** The three roles the API knows, least to most; `null` is "nobody signed in yet". */
export type ViewerRole = 'viewer' | 'operator' | 'admin';
const ROLE_RANK: Record<ViewerRole, number> = { viewer: 0, operator: 1, admin: 2 };

/** Whether `role` meets a tab's `access` floor. An absent floor admits everyone. */
export function roleMeets(access: TabAccess | undefined, role: ViewerRole | null): boolean {
  if (access === undefined) return true;
  if (role === null) return false;
  return ROLE_RANK[role] >= ROLE_RANK[access];
}

/**
 * A section's tabs that `role` may use, in manifest order.
 *
 * The API enforces access; this only decides which tabs to draw, so a viewer is not shown a
 * tab that would answer 403. The length rule still applies to the *filtered* set: a section
 * that leaves one tab after filtering shows no tab row, exactly as a one-page section does.
 */
export function visibleTabsOf(section: SectionId, role: ViewerRole | null): TabRoute[] {
  const tabs = tabsOf(section).filter((tab) =>
    roleMeets((tab as { access?: TabAccess }).access, role),
  );
  return tabs.length > 1 ? tabs : [];
}

/** Whether a tab lives in its row's "More" menu, because the place already shows four. */
export function isOverflowTab(tab: TabRoute): boolean {
  return (tab as { overflow?: boolean }).overflow === true;
}

/** The named group a tab sits in on its row, or `undefined` for a row with none. */
export function groupOf(tab: TabRoute): string | undefined {
  return (tab as { group?: string }).group;
}

/**
 * A tab row split into its named groups (Settings: Personal, Workspace, Install, Tools), so it
 * reads as four short groups rather than fourteen tabs in a line. A row with no named groups
 * splits where the access floor changes instead.
 */
export function tabGroups(tabs: readonly TabRoute[]): TabRoute[][] {
  const groups: TabRoute[][] = [];
  const named = new Map<string, TabRoute[]>();
  let floor: string | undefined | null = null;
  for (const tab of tabs) {
    const name = groupOf(tab);
    if (name !== undefined) {
      // A named group gathers its tabs wherever they sit in the manifest, so "Health" is
      // one run of tabs even when a Delivery route was declared between two of them.
      const existing = named.get(name);
      if (existing !== undefined) {
        existing.push(tab);
      } else {
        const group = [tab];
        named.set(name, group);
        groups.push(group);
      }
      floor = null;
      continue;
    }
    const key = (tab as { access?: TabAccess }).access;
    if (groups.length === 0 || key !== floor) groups.push([]);
    groups[groups.length - 1]?.push(tab);
    floor = key;
  }
  return groups;
}

/**
 * A metric's detail page, for the window the cockpit was showing. The metric ids are the
 * cockpit contract's; the window is carried so the page compares what the person was looking at.
 */
export function metricPath(
  metricId: string,
  window?: '7d' | 'release',
  projectId?: string,
): string {
  const base = `/dashboard/metric/${encodeURIComponent(metricId)}`;
  const params: string[] = [];
  if (window !== undefined) params.push(`window=${window}`);
  if (projectId !== undefined) params.push(`project=${encodeURIComponent(projectId)}`);
  return params.length === 0 ? base : `${base}?${params.join('&')}`;
}

/** The cockpit for one project; without one it shows the project that reported last. */
export function cockpitPath(projectId?: string): string {
  return projectId === undefined
    ? '/dashboard/now'
    : `/dashboard/now?project=${encodeURIComponent(projectId)}`;
}

/**
 * The cockpit as one downloadable HTML file, for the window being shown. It is an API address,
 * not a page of this app, so it is followed as a download rather than routed to.
 */
export function reportPath(projectId: string, window: '7d' | 'release'): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/cockpit/report.html?window=${window}&download=1`;
}

export function runDetailPath(runId: string): string {
  return `/dashboard/runs/${encodeURIComponent(runId)}`;
}

export function repoHealthPath(projectId: string): string {
  return `/dashboard/repo/${encodeURIComponent(projectId)}`;
}

/** One repository's GitHub overview: its grade, findings and open work. */
export function repoDetailPath(projectId: string): string {
  return `/dashboard/repos/${encodeURIComponent(projectId)}`;
}

export function repo360Path(projectId: string): string {
  return `${repoHealthPath(projectId)}/overview`;
}

/**
 * The path to one test's history. The identity is a search parameter, not a path segment,
 * because it is a file path and holds `/`. One place builds it, so every link agrees.
 */
export function testHistoryPath(key: string): string {
  return `/dashboard/test?key=${encodeURIComponent(key)}`;
}

/** One page in the sidebar: its address, its name there, and the named group it sits in. */
export interface NavPage {
  id: string;
  path: string;
  label: string;
  group?: string;
}

/** One place in the sidebar and every page under it, in the order the sidebar draws them. */
export interface NavGroup {
  id: SectionId;
  label: string;
  path: string;
  pages: NavPage[];
}

/**
 * The sidebar, built from the manifest: the five places, each with every page the role may
 * open. A page is listed when it is visible or has a tab; a page reached only by a link (a run,
 * a metric, a repository) is not, and still marks its place current. Named groups are gathered
 * the way `tabGroups` gathers them, so Settings reads Personal, Workspace, Install, Tools.
 */
export function navTree(role: ViewerRole | null): NavGroup[] {
  return SECTIONS.map((section) => {
    const inSection = routeManifest.filter(
      (route) =>
        route.section === section.id && roleMeets((route as { access?: TabAccess }).access, role),
    );
    const withTabs = inSection.filter((route): route is TabRoute => 'tab' in route);
    // Every place has tabs; its older untabbed aliases still resolve by address and are not
    // listed, so one page never appears twice.
    const ordered = tabGroups(withTabs).flat();
    return {
      id: section.id,
      label: section.label,
      path: section.path,
      pages: ordered.map((route) => {
        const group = (route as { group?: string }).group;
        return {
          id: route.id,
          path: route.path,
          label: sidebarLabel(section.id, section.label, route.tab),
          ...(group === undefined ? {} : { group }),
        };
      }),
    };
  });
}

/**
 * A page named after its own place reads twice in the sidebar ("Runs > Runs"). The sidebar
 * calls it what it is: the overview of the place, or for Runs the list of every run.
 */
function sidebarLabel(section: SectionId, place: string, tab: string): string {
  if (tab !== place) return tab;
  return section === 'runs' ? 'All runs' : 'Overview';
}
