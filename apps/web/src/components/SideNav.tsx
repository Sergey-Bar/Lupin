import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  House,
  LayoutGrid,
  Layers,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  Wordmark,
  Select,
  cn,
} from '@lupin/ui';
import { defaultApiClient, type ApiClient } from '../lib/api.js';
import { runsNeedingYou } from '../lib/attention.js';
import {
  navTree,
  routeFor,
  sectionOf,
  type NavGroup,
  type NavPage,
  type SectionId,
} from '../route-manifest.js';
import { useViewerRole } from '../hooks/useViewerRole.js';
import { publishRuns, useLatestRuns } from '../hooks/useRuns.js';
import { useResource } from '../hooks/useResource.js';
import { useScope } from '../hooks/useScope.js';
import { scopeSearch } from '../lib/scope.js';
import { createQaClient } from '../lib/qa-client.js';
import { createSettingsClient } from '../lib/settings-client.js';
import type { Onboarding } from '@lupin/shared-contracts';

/** The projects the scope switcher offers. */
export type ScopeProjects = () => Promise<ReadonlyArray<{ id: string; name: string }>>;

function readProjects(): Promise<ReadonlyArray<{ id: string; name: string }>> {
  return createQaClient().listProjects();
}

/** Whether the sidebar is the icon rail or the full column, kept per browser. */
export const SIDEBAR_KEY = 'lupin-sidebar';
/** Which places are open in the full column, kept per browser. */
export const SIDEBAR_GROUPS_KEY = 'lupin-sidebar-groups';
/** The last page outside Settings, which "Back to Lupin" returns to. */
export const SIDEBAR_RETURN_KEY = 'lupin-sidebar-return';

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

const SECTION_ICONS: Record<SectionId, typeof LayoutGrid> = {
  now: House,
  runs: ListChecks,
  tests: FlaskConical,
  health: ShieldCheck,
  settings: Settings,
};

type PlaceCounts = Partial<Record<SectionId, number>>;

/**
 * How many things each place asks of you, read once per place you move to. Runs counts what
 * the Runs page lists (`runsNeedingYou`), so the badge and the page cannot disagree. A failed
 * read shows no count: a number that might be wrong is worse than none.
 */
function usePlaceCounts(api: Pick<ApiClient, 'getRuns'>, section: SectionId | null): PlaceCounts {
  const runs = useLatestRuns();
  React.useEffect(() => {
    // Settings mode lists no places, and on Runs the page's own `useRuns` reads the list and
    // shares it, so a second fetch there would only double the request.
    if (section === 'settings' || section === 'runs') return undefined;
    const controller = new AbortController();
    api.getRuns({ signal: controller.signal }).then(
      (list) => {
        if (!controller.signal.aborted) publishRuns(list);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [api, section]);
  return React.useMemo(() => {
    if (runs === null) return {};
    const { red, stuck } = runsNeedingYou(runs, new Date());
    return { runs: red.length + stuck.length };
  }, [runs]);
}

/** "Runs, 2 need you": the count said in words, since the badge itself is hidden. */
function placeLabel(label: string, count: number): string {
  if (count === 0) return label;
  return `${label}, ${count} ${count === 1 ? 'needs' : 'need'} you`;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A storage that refuses writes keeps the choice for this page only.
  }
}

function readOpenGroups(): SectionId[] {
  try {
    const parsed: unknown = JSON.parse(read(SIDEBAR_GROUPS_KEY) ?? '[]');
    // Only a list of names is a remembered state; anything else is nothing remembered.
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? (parsed as SectionId[])
      : [];
  } catch {
    return [];
  }
}

/** The page the sidebar marks current: the manifest entry the address opens, by id. */
function useCurrentPage(): { path: string; pageId: string | undefined; section: SectionId | null } {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return { path, pageId: routeFor(path)?.id, section: sectionOf(path) };
}

/** Arrow keys walk every link in the list the focus is in; Home and End jump to its ends. */
function onListKeys(event: KeyboardEvent, root: HTMLElement): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...root.querySelectorAll<HTMLElement>('a[href], button[data-place]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at === -1) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
  items[next]?.focus();
}

/**
 * The keyboard on a list, attached by ref: the arrow keys walk it, and Escape calls the given close.
 * By ref rather than as JSX props because the element is a nav or a ul, which take no
 * handlers of their own; the links inside are what receive focus.
 */
function useListKeys<T extends HTMLElement>(onEscape?: () => void): (node: T | null) => void {
  const escape = React.useRef(onEscape);
  escape.current = onEscape;
  const detach = React.useRef<(() => void) | null>(null);
  // A callback ref: it runs when the element mounts and unmounts, so a list that appears
  // later (a flyout) is listened on the moment it exists.
  return React.useCallback((root: T | null) => {
    detach.current?.();
    detach.current = null;
    if (root === null) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && escape.current !== undefined) {
        escape.current();
        return;
      }
      // A list with a close (a flyout) handles Escape only; the arrows are the nav's, which
      // hears them as they bubble, so one press moves focus once.
      if (escape.current === undefined) onListKeys(event, root);
    };
    root.addEventListener('keydown', listener);
    detach.current = () => root.removeEventListener('keydown', listener);
  }, []);
}

/**
 * The one chrome, Codex-style: every page of the product in one column.
 *
 * Two modes. **App mode** lists the four places as groups that open to their pages; the place
 * you are in opens by itself, and what else is open is remembered. **Settings mode** replaces
 * the list with Settings' own, grouped Personal, Workspace, Install and Tools, with "Back to
 * Lupin" returning to the page you came from (System Settings on a Mac). Collapsed, it is an
 * icon rail and a place opens as a flyout of its pages. Below `lg` the top bar's drawer shows
 * the same list (`SidebarList`).
 */
export function SideNav({
  api = defaultApiClient,
  onboarding = readOnboarding,
  projects = readProjects,
}: {
  api?: ApiClient;
  /** Setup progress, for the "Finish setup" chip. */
  onboarding?: () => Promise<Onboarding>;
  /** The projects the scope switcher offers. */
  projects?: ScopeProjects;
}): React.ReactElement {
  const { path, section } = useCurrentPage();
  const [collapsed, setCollapsed] = React.useState(() => read(SIDEBAR_KEY) !== 'expanded');
  const settingsMode = section === 'settings';
  React.useEffect(() => {
    if (section !== null && section !== 'settings') write(SIDEBAR_RETURN_KEY, path);
  }, [path, section]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    write(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
  };
  return (
    <aside
      data-testid="side-nav"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-mode={settingsMode ? 'settings' : 'app'}
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-border surface-translucent transition-[width] duration-100 motion-reduce:transition-none lg:flex',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <SideHeader collapsed={collapsed} onToggle={toggle} />
      <div className={collapsed ? 'flex justify-center pb-2' : 'px-3 pb-2'}>
        <AskButton compact={collapsed} />
      </div>
      <SidebarList
        api={api}
        projects={projects}
        collapsed={collapsed}
        onExpand={toggle}
        className={collapsed ? 'px-2' : 'px-3'}
      />
      {settingsMode || collapsed ? null : <SetupChip onboarding={onboarding} section={section} />}
      {settingsMode ? null : <SettingsFoot collapsed={collapsed} />}
    </aside>
  );
}

function readOnboarding(): Promise<Onboarding> {
  return createSettingsClient().getOnboarding();
}

/**
 * "Finish setup · 2 of 6", above Settings, while setup is unfinished and not dismissed. Read
 * again on each move between places, so a step done elsewhere counts. A failed read shows
 * nothing: setup is an offer.
 */
function SetupChip({
  onboarding,
  section,
}: {
  onboarding: () => Promise<Onboarding>;
  section: SectionId | null;
}): React.ReactElement | null {
  const [progress, setProgress] = React.useState<Onboarding | null>(null);
  React.useEffect(() => {
    let live = true;
    onboarding().then(
      (value) => {
        if (live) setProgress(value);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [onboarding, section]);
  if (progress === null || progress.dismissed || progress.done >= progress.total) return null;
  const { done, total } = progress;
  return (
    <div className="shrink-0 px-3 pb-2">
      <Link
        to="/dashboard/setup"
        aria-label={`Finish setup, ${done} of ${total} done`}
        className={cn(
          'grid gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-fg transition-colors duration-100 hover:bg-surface-raised motion-reduce:transition-none',
          FOCUS,
        )}
      >
        <span className="font-medium">
          Finish setup{' '}
          <span className="text-fg-muted">
            · {done} of {total}
          </span>
        </span>
        <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-surface-muted">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${String((done / total) * 100)}%` }}
          />
        </span>
      </Link>
    </div>
  );
}

/** The wordmark and the one toggle between the rail and the full column. */
function SideHeader({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <div
      className={cn(
        'flex h-14 shrink-0 items-center',
        collapsed ? 'justify-center' : 'justify-between ps-5 pe-2',
      )}
    >
      {collapsed ? null : <Wordmark data-testid="side-wordmark" decorative />}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={label}
        title={label}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors duration-100 hover:bg-surface-raised hover:text-fg motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        {collapsed ? (
          <PanelLeftOpen size={16} aria-hidden="true" />
        ) : (
          <PanelLeftClose size={16} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/** Settings, as one quiet icon below the places; Settings mode has its own Back instead. */
function SettingsFoot({ collapsed }: { collapsed: boolean }): React.ReactElement {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center border-t border-border py-3',
        collapsed ? 'flex-col gap-1 px-1' : 'px-3',
      )}
    >
      <Link
        to="/dashboard/settings"
        aria-label="Settings"
        title="Settings"
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-muted transition-colors duration-100 hover:bg-surface-raised hover:text-fg motion-reduce:transition-none',
          FOCUS,
        )}
      >
        <Settings size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * The list itself, in whichever mode the page puts it: the desktop column and the phone drawer
 * draw the same thing, so a page can never be reachable from one and not the other.
 */
export function SidebarList({
  api = defaultApiClient,
  projects = readProjects,
  collapsed = false,
  onExpand,
  className,
  onNavigate,
}: {
  api?: Pick<ApiClient, 'getRuns'>;
  projects?: ScopeProjects;
  collapsed?: boolean;
  /** Opens the full column from the rail, for a control that needs the room. */
  onExpand?: () => void;
  className?: string;
  /** Called after a link is followed; the drawer closes itself. */
  onNavigate?: () => void;
}): React.ReactElement {
  const { pageId, section } = useCurrentPage();
  const role = useViewerRole();
  const counts = usePlaceCounts(api, section);
  const scope = useScope();
  const tree = navTree(role);
  if (section === 'settings') {
    const settings = tree.find((group) => group.id === 'settings');
    return (
      <SettingsList
        pages={settings?.pages ?? []}
        pageId={pageId}
        collapsed={collapsed}
        className={className}
        onNavigate={onNavigate}
      />
    );
  }
  return (
    <>
      <ScopeSwitcher
        projects={projects}
        value={scope.projectId}
        onChange={scope.choose}
        collapsed={collapsed}
        onExpand={onExpand}
        className={className}
      />
      <AppList
        groups={tree.filter((group) => group.id !== 'settings')}
        counts={counts}
        pageId={pageId}
        section={section}
        scope={scope.projectId}
        collapsed={collapsed}
        className={className}
        onNavigate={onNavigate}
      />
    </>
  );
}

/**
 * Which project every page is about, or every project: the one place the scope is chosen.
 * Hidden with fewer than two projects (a choice of one is not a control) and when the list
 * cannot be read, so the pages open as they would with nothing chosen. A remembered project
 * that is no longer registered reads as every project.
 */
function ScopeSwitcher({
  projects,
  value,
  onChange,
  collapsed,
  onExpand,
  className,
}: {
  projects: ScopeProjects;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  /** On the icon rail the switcher is a button that names the scope and opens the column. */
  collapsed: boolean;
  onExpand?: (() => void) | undefined;
  className?: string | undefined;
}): React.ReactElement | null {
  const list = useResource(() => projects(), [projects]);
  if (list.status !== 'ready' || list.value.length < 2) return null;
  const chosen = list.value.find((project) => project.id === value);
  if (collapsed) {
    const name = chosen?.name ?? 'All projects';
    return (
      <div className={cn('flex shrink-0 justify-center pb-2', className)}>
        <button
          type="button"
          data-testid="scope-switcher-rail"
          onClick={onExpand}
          aria-label={`Project scope: ${name}. Open the sidebar to change it`}
          title={`Project scope: ${name}`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors duration-100 hover:bg-surface-raised hover:text-fg motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <Layers size={16} aria-hidden="true" />
          {chosen === undefined ? null : (
            <span
              aria-hidden="true"
              className="absolute end-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent"
            />
          )}
        </button>
      </div>
    );
  }
  return (
    <div className={cn('shrink-0 pb-2', className)} data-testid="scope-switcher">
      <Select
        id="scope-switcher-select"
        label="Project scope"
        value={chosen === undefined ? '' : chosen.id}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        options={[
          { value: '', label: 'All projects' },
          ...list.value.map((project) => ({ value: project.id, label: project.name })),
        ]}
      />
    </div>
  );
}

function AppList({
  groups,
  counts,
  pageId,
  section,
  scope,
  collapsed,
  className,
  onNavigate,
}: {
  groups: NavGroup[];
  counts: PlaceCounts;
  pageId: string | undefined;
  section: SectionId | null;
  /** The chosen project: a link to a page that reads `?project=` carries it. */
  scope: string | undefined;
  collapsed: boolean;
  className?: string | undefined;
  onNavigate?: (() => void) | undefined;
}): React.ReactElement {
  const [open, setOpen] = React.useState<SectionId[]>(readOpenGroups);
  const [flyout, setFlyout] = React.useState<SectionId | null>(null);
  const keys = useListKeys<HTMLElement>();
  const isOpen = (id: SectionId) => id === section || open.includes(id);
  const flip = (id: SectionId) => {
    if (collapsed) {
      setFlyout((current) => (current === id ? null : id));
      return;
    }
    const next = isOpen(id) ? open.filter((item) => item !== id) : [...open, id];
    setOpen(next);
    write(SIDEBAR_GROUPS_KEY, JSON.stringify(next));
  };
  return (
    <nav
      ref={keys}
      aria-label="Sidebar"
      className={cn('min-h-0 flex-1 overflow-y-auto pb-4 pt-2', className)}
    >
      <ul className="flex flex-col gap-0.5">
        {groups.map((group) =>
          group.pages.length === 1 && group.pages[0] !== undefined ? (
            <PlaceLink
              key={group.id}
              group={group}
              page={group.pages[0]}
              scope={scope}
              count={counts[group.id] ?? 0}
              current={group.pages[0].id === pageId}
              collapsed={collapsed}
              onNavigate={() => {
                setFlyout(null);
                onNavigate?.();
              }}
            />
          ) : (
            <PlaceGroup
              key={group.id}
              group={group}
              scope={scope}
              count={counts[group.id] ?? 0}
              pageId={pageId}
              here={group.id === section}
              open={collapsed ? flyout === group.id : isOpen(group.id)}
              collapsed={collapsed}
              onFlip={() => flip(group.id)}
              onClose={() => setFlyout(null)}
              onNavigate={() => {
                setFlyout(null);
                onNavigate?.();
              }}
            />
          ),
        )}
      </ul>
    </nav>
  );
}

/**
 * A place with one page is that page: a link, not a group that opens to a list of one. It
 * carries the place's icon, count and name, and marks itself current like any page.
 */
function PlaceLink({
  group,
  page,
  scope,
  count,
  current,
  collapsed,
  onNavigate,
}: {
  group: NavGroup;
  page: NavPage;
  scope: string | undefined;
  count: number;
  current: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}): React.ReactElement {
  const Icon = SECTION_ICONS[group.id];
  return (
    <li>
      <Link
        to={page.path}
        search={scopeSearch(page.id, scope)}
        data-place={group.id}
        aria-current={current ? 'page' : undefined}
        aria-label={placeLabel(group.label, count)}
        title={collapsed ? group.label : undefined}
        onClick={onNavigate}
        className={cn(
          collapsed ? 'relative justify-center' : 'px-2',
          'flex min-h-9 w-full items-center gap-2.5 rounded-md text-sm transition-colors duration-100 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          current
            ? 'bg-surface-muted font-semibold text-fg'
            : 'font-medium text-fg-muted hover:bg-surface-raised hover:text-fg',
        )}
      >
        <Icon size={16} aria-hidden="true" className={current ? 'text-accent' : undefined} />
        {collapsed ? <PlaceCount count={count} dot /> : null}
        {collapsed ? null : (
          <>
            <span className="flex-1 text-start">{group.label}</span>
            <PlaceCount count={count} />
          </>
        )}
      </Link>
    </li>
  );
}

/**
 * How many things a place asks of you: a number in the column, a dot on the rail. Hidden from
 * assistive tech because the group's own name already says it in words.
 */
function PlaceCount({ count, dot = false }: { count: number; dot?: boolean }): React.ReactNode {
  if (count === 0) return null;
  if (dot) {
    return (
      <span
        data-testid="place-count"
        aria-hidden="true"
        className="absolute end-2 top-1.5 h-2 w-2 rounded-full bg-danger"
      />
    );
  }
  return (
    <span
      data-testid="place-count"
      aria-hidden="true"
      className="min-w-5 rounded-full bg-danger/10 px-1.5 text-center text-xs font-semibold tabular-nums text-danger"
    >
      {count}
    </span>
  );
}

function PlaceGroup({
  group,
  scope,
  count,
  pageId,
  here,
  open,
  collapsed,
  onFlip,
  onClose,
  onNavigate,
}: {
  group: NavGroup;
  scope: string | undefined;
  count: number;
  pageId: string | undefined;
  here: boolean;
  open: boolean;
  collapsed: boolean;
  onFlip: () => void;
  onClose: () => void;
  onNavigate: () => void;
}): React.ReactElement {
  const Icon = SECTION_ICONS[group.id];
  const listId = `side-group-${group.id}`;
  const flyoutKeys = useListKeys<HTMLUListElement>(onClose);
  return (
    <li className="relative">
      <button
        type="button"
        data-place={group.id}
        aria-expanded={open}
        aria-controls={listId}
        title={collapsed ? group.label : undefined}
        aria-label={placeLabel(group.label, count)}
        onClick={onFlip}
        className={cn(
          collapsed ? 'relative justify-center' : 'px-2',
          'flex min-h-9 w-full items-center gap-2.5 rounded-md text-sm transition-colors duration-100 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          here
            ? 'font-semibold text-fg'
            : 'font-medium text-fg-muted hover:bg-surface-raised hover:text-fg',
        )}
      >
        <Icon size={16} aria-hidden="true" className={here ? 'text-accent' : undefined} />
        {collapsed ? <PlaceCount count={count} dot /> : null}
        {collapsed ? null : (
          <>
            <span className="flex-1 text-start">{group.label}</span>
            <PlaceCount count={count} />
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={cn(
                'text-fg-muted transition-transform duration-100 motion-reduce:transition-none',
                open && 'rotate-90',
              )}
            />
          </>
        )}
      </button>
      {open ? (
        <ul
          id={listId}
          ref={flyoutKeys}
          aria-label={`${group.label} pages`}
          className={cn(
            'flex flex-col gap-0.5',
            collapsed
              ? 'absolute start-full top-0 z-popover ms-2 w-56 rounded-lg border border-border surface-translucent p-2 shadow-elevation-3 animate-fade-in'
              : 'mt-0.5 border-s border-border ms-4 ps-2',
          )}
        >
          {group.pages.map((page) => (
            <li key={page.id}>
              <PageLink
                page={page}
                scope={scope}
                current={page.id === pageId}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SettingsList({
  pages,
  pageId,
  collapsed,
  className,
  onNavigate,
}: {
  pages: NavPage[];
  pageId: string | undefined;
  collapsed: boolean;
  className?: string | undefined;
  onNavigate?: (() => void) | undefined;
}): React.ReactElement {
  const keys = useListKeys<HTMLElement>();
  const back = read(SIDEBAR_RETURN_KEY) ?? '/dashboard/now';
  const groups = [...new Set(pages.map((page) => page.group ?? 'Settings'))];
  return (
    <nav
      ref={keys}
      aria-label="Settings"
      className={cn('min-h-0 flex-1 overflow-y-auto pb-4 pt-2 animate-fade-in', className)}
    >
      <Link
        to={back}
        {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
        title={collapsed ? 'Back to Lupin' : undefined}
        aria-label={collapsed ? 'Back to Lupin' : undefined}
        className={cn(
          collapsed ? 'justify-center' : 'px-2',
          'mb-3 flex min-h-9 items-center gap-2 rounded-md text-sm font-medium text-fg-muted transition-colors duration-100 hover:bg-surface-raised hover:text-fg motion-reduce:transition-none',
          FOCUS,
        )}
      >
        <ChevronLeft size={16} aria-hidden="true" />
        {collapsed ? null : <span>Back to Lupin</span>}
      </Link>
      {collapsed ? null : (
        <div className="flex flex-col gap-4">
          {groups.map((name) => (
            <div key={name}>
              <p
                aria-hidden="true"
                className="mb-1 px-2 text-xs font-medium tracking-wide text-fg-muted"
              >
                {name}
              </p>
              <ul aria-label={name} className="flex flex-col gap-0.5">
                {pages
                  .filter((page) => (page.group ?? 'Settings') === name)
                  .map((page) => (
                    <li key={page.id}>
                      <PageLink page={page} current={page.id === pageId} onNavigate={onNavigate} />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

function PageLink({
  page,
  scope,
  current,
  onNavigate,
}: {
  page: NavPage;
  /** The chosen project; carried only by a page that reads `?project=`. Settings has none. */
  scope?: string | undefined;
  current: boolean;
  onNavigate?: (() => void) | undefined;
}): React.ReactElement {
  return (
    <Link
      to={page.path}
      search={scopeSearch(page.id, scope)}
      activeOptions={{ exact: true }}
      aria-current={current ? 'page' : undefined}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
      className={cn(
        'relative flex min-h-8 items-center rounded-md px-2 text-sm transition-colors duration-100 motion-reduce:transition-none',
        FOCUS,
        // The page you are on: a short accent bar on the leading edge, so the list reads at a
        // glance and not only by a fill.
        current
          ? 'bg-surface-muted font-semibold text-fg before:absolute before:start-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent'
          : 'font-medium text-fg-muted hover:bg-surface-raised hover:text-fg',
      )}
    >
      {page.label}
    </Link>
  );
}

/**
 * The one primary action, at the top like Codex's "New task": ask Lupin anything, which opens
 * the command palette. It sends the same Ctrl+K the palette already listens for, so there is
 * one way in and no second palette state to keep in step.
 */
function AskButton({ compact = false }: { compact?: boolean }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() =>
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
        )
      }
      aria-label={compact ? 'Ask Lupin' : undefined}
      title={compact ? 'Ask Lupin (⌘K)' : undefined}
      className={cn(
        compact ? 'h-10 w-10 justify-center' : 'w-full px-3',
        'flex min-h-10 items-center gap-2.5 rounded-md bg-surface-raised text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-muted motion-reduce:transition-none',
        FOCUS,
      )}
    >
      <Sparkles size={16} aria-hidden="true" className="text-accent" />
      {compact ? null : <span className="flex-1 text-start">Ask Lupin</span>}
      {compact ? null : (
        <kbd className="rounded border border-border px-1.5 font-mono text-xs text-fg-muted">
          ⌘K
        </kbd>
      )}
    </button>
  );
}
