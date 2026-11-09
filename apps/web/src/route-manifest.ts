/**
 * Every navigable page, and the section it belongs to.
 *
 * ## Four sections, and every old URL is still a page
 *
 * The product used to have eight top-level destinations. It has four now — Overview,
 * Runs, Insights, Map — and the eight became **tabs** of those sections rather than
 * being merged or redirected, so a bookmark to `/dashboard/analytics` opens the same
 * page it always did, now inside Insights. `section` is the one place that decision is
 * written; `NavBar`, `BottomTabBar`, `SectionTabs` and the command palette all read it.
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
  { id: 'overview', label: 'Overview', path: '/dashboard/now' },
  { id: 'runs', label: 'Runs', path: '/dashboard/runs' },
  { id: 'insights', label: 'Insights', path: '/dashboard/insights' },
  { id: 'map', label: 'Map', path: '/dashboard/map' },
  { id: 'github', label: 'GitHub', path: '/dashboard/prs' },
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
  readonly access?: TabAccess;
}

export const routeManifest = [
  {
    id: 'now',
    path: '/dashboard/now',
    label: 'Cockpit',
    visible: true,
    section: 'overview',
    tab: 'Cockpit',
  },
  // First-run setup: a guided flow, reached from the cockpit and the checklist, never a tab.
  {
    id: 'setup',
    path: '/dashboard/setup',
    label: 'Set up Lupin',
    visible: false,
    section: 'overview',
  },
  {
    id: 'metric',
    path: '/dashboard/metric/:metricId',
    label: 'Metric',
    visible: false,
    section: 'overview',
  },
  {
    id: 'portfolio',
    path: '/dashboard/portfolio',
    label: 'Portfolio',
    visible: true,
    section: 'overview',
    tab: 'Portfolio',
  },
  {
    id: 'dashboard',
    path: '/dashboard',
    label: 'Overview',
    visible: true,
    section: 'overview',
    tab: 'Project',
  },
  {
    id: 'repo-health',
    path: '/dashboard/repo/:projectId',
    label: 'Repository Health',
    visible: false,
    section: 'overview',
  },
  {
    id: 'repo-360',
    path: '/dashboard/repo/:projectId/overview',
    label: 'Repository 360',
    visible: false,
    section: 'overview',
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
    section: 'insights',
    tab: 'Tests',
  },
  {
    id: 'analytics',
    path: '/dashboard/analytics',
    label: 'Trends',
    visible: false,
    section: 'insights',
  },
  {
    id: 'quarantine',
    path: '/dashboard/quarantine',
    label: 'Quarantine',
    visible: false,
    section: 'insights',
  },
  {
    id: 'test-history',
    path: '/dashboard/test',
    label: 'Test History',
    visible: false,
    section: 'insights',
  },
  {
    id: 'delivery',
    path: '/dashboard/delivery',
    label: 'Delivery',
    visible: true,
    section: 'insights',
    tab: 'Delivery',
  },
  {
    id: 'ai-code',
    path: '/dashboard/ai-code',
    label: 'AI code',
    visible: true,
    section: 'insights',
    tab: 'AI code',
  },
  {
    id: 'agents',
    path: '/dashboard/agents',
    label: 'Agents',
    visible: false,
    section: 'insights',
  },
  {
    id: 'score',
    path: '/dashboard/score/:projectId',
    label: 'Health Score',
    visible: false,
    section: 'insights',
  },
  {
    id: 'gaps',
    path: '/dashboard/gaps/:projectId',
    label: 'Automation Gaps',
    visible: false,
    section: 'insights',
  },
  {
    id: 'hollow',
    path: '/dashboard/hollow/:projectId',
    label: 'Hollow Tests',
    visible: false,
    section: 'insights',
  },
  {
    id: 'flaky',
    path: '/dashboard/flaky/:projectId',
    label: 'Flaky Tests',
    visible: false,
    section: 'insights',
  },
  {
    id: 'structure',
    path: '/dashboard/structure/:projectId',
    label: 'Structural Findings',
    visible: false,
    section: 'insights',
  },
  { id: 'map', path: '/dashboard/map', label: 'Map', visible: true, section: 'map', tab: 'Map' },
  {
    id: 'health',
    path: '/dashboard/health',
    label: 'Capabilities',
    visible: true,
    section: 'map',
    tab: 'Capabilities',
  },
  {
    id: 'supply-chain',
    path: '/dashboard/supply-chain',
    label: 'Supply chain',
    visible: true,
    section: 'map',
    tab: 'Supply chain',
  },
  {
    id: 'toolbox',
    path: '/dashboard/toolbox',
    label: 'Toolbox',
    visible: true,
    section: 'map',
    tab: 'Toolbox',
  },
  {
    id: 'access',
    path: '/dashboard/access',
    label: 'Access',
    visible: true,
    section: 'map',
    tab: 'Access',
  },
  {
    id: 'members',
    path: '/dashboard/members',
    label: 'Members',
    visible: true,
    section: 'map',
    tab: 'Members',
  },
  {
    id: 'audit',
    path: '/dashboard/audit',
    label: 'Audit trail',
    visible: true,
    section: 'map',
    tab: 'Audit',
  },
  {
    id: 'deployment',
    path: '/dashboard/deployment',
    label: 'Deployment',
    visible: true,
    section: 'map',
    tab: 'Deployment',
  },
  {
    id: 'reports',
    path: '/dashboard/reports',
    label: 'Reports',
    visible: true,
    section: 'map',
    tab: 'Reports',
  },
  {
    id: 'prs',
    path: '/dashboard/prs',
    label: 'Pull requests',
    visible: true,
    section: 'github',
    tab: 'Pull requests',
  },
  {
    id: 'issues',
    path: '/dashboard/issues',
    label: 'Issues',
    visible: true,
    section: 'github',
    tab: 'Issues',
  },
  {
    id: 'repos',
    path: '/dashboard/repos',
    label: 'Repositories',
    visible: true,
    section: 'github',
    tab: 'Repositories',
  },
  {
    id: 'repo-detail',
    path: '/dashboard/repos/:projectId',
    label: 'Repository',
    visible: false,
    section: 'github',
  },
  {
    id: 'pair',
    path: '/dashboard/pair',
    label: 'Pair this device',
    visible: false,
    section: 'map',
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
  },
  {
    id: 'settings-projects',
    path: '/dashboard/settings/projects',
    label: 'Project settings',
    visible: false,
    section: 'settings',
    tab: 'Projects',
  },
  {
    id: 'settings-reports',
    path: '/dashboard/settings/reports',
    label: 'Report settings',
    visible: false,
    section: 'settings',
    tab: 'Reports',
  },
  {
    id: 'settings-quality-gates',
    path: '/dashboard/settings/quality-gates',
    label: 'Quality gate settings',
    visible: false,
    section: 'settings',
    tab: 'Quality gates',
  },
  {
    id: 'settings-members',
    path: '/dashboard/settings/members',
    label: 'Member settings',
    visible: false,
    section: 'settings',
    tab: 'Members',
    access: 'admin',
  },
  {
    id: 'settings-ai',
    path: '/dashboard/settings/ai',
    label: 'AI provider settings',
    visible: false,
    section: 'settings',
    tab: 'AI provider',
    access: 'admin',
  },
  {
    id: 'settings-integrations',
    path: '/dashboard/settings/integrations',
    label: 'Integration settings',
    visible: false,
    section: 'settings',
    tab: 'Integrations',
    access: 'admin',
  },
  {
    id: 'settings-identity',
    path: '/dashboard/settings/identity',
    label: 'Identity settings',
    visible: false,
    section: 'settings',
    tab: 'Identity',
    access: 'admin',
  },
  {
    id: 'settings-sessions',
    path: '/dashboard/settings/sessions',
    label: 'Session and retention settings',
    visible: false,
    section: 'settings',
    tab: 'Sessions & retention',
    access: 'admin',
  },
  {
    id: 'settings-access',
    path: '/dashboard/settings/access',
    label: 'Access settings',
    visible: false,
    section: 'settings',
    tab: 'Access',
    access: 'admin',
  },
  {
    id: 'settings-audit',
    path: '/dashboard/settings/audit',
    label: 'Audit settings',
    visible: false,
    section: 'settings',
    tab: 'Audit',
    access: 'admin',
  },
  {
    id: 'settings-deployment',
    path: '/dashboard/settings/deployment',
    label: 'Deployment settings',
    visible: false,
    section: 'settings',
    tab: 'Deployment',
    access: 'admin',
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
