import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  Activity,
  GitBranch,
  INDICATOR_ACTIVE_ATTRIBUTE,
  LayoutGrid,
  ListChecks,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Settings,
  cn,
  useSlidingIndicator,
} from '@lupin/ui';
import {
  SECTIONS,
  routeFor,
  sectionOf,
  tabsOf,
  visibleTabsOf,
  type SectionId,
} from '../route-manifest.js';
import { ThemeToggle } from './ThemeToggle.js';
import { useViewerRole } from '../hooks/useViewerRole.js';
import { useRecentRuns } from '../hooks/useRecentRuns.js';

/**
 * The chrome: a sidebar, and two surfaces for a phone.
 *
 * - `NavBar` — the sidebar from `lg` up (sections, the section's pages, recent runs, the
 *   theme), and the slim top header below `lg`.
 * - `SectionTabs` — the section's pages as a tab row, below `lg` only; the sidebar lists them
 *   from `lg` up.
 * - `BottomTabBar` — the sections as a thumb-reach tab bar below `lg`.
 *
 * All three read `SECTIONS` and `sectionOf` from the manifest, so there is one answer to
 * "where am I". The current section is marked with `aria-current="page"` **and** with
 * weight and a rule, never with colour alone.
 *
 * **No Logout button.** The install is open, so there is no session to end.
 */

const SECTION_ICONS: Record<SectionId, typeof LayoutGrid> = {
  overview: LayoutGrid,
  runs: ListChecks,
  insights: Activity,
  map: Network,
  github: GitBranch,
  settings: Settings,
};

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

function useCurrentPath(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

const SIDEBAR_KEY = 'lupin-sidebar';

function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggle = React.useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
      } catch {
        // A browser that refuses storage still collapses; it just forgets on reload.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

/** The tabs a section shows, by role for Settings, and none for a one-page section. */
function useSectionPages(section: SectionId | null) {
  const role = useViewerRole();
  if (section === null) return [];
  return section === 'settings' ? visibleTabsOf(section, role) : tabsOf(section);
}

/** A sidebar row: an icon, and a label that becomes screen-reader text when collapsed. */
const ROW =
  'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors duration-100 motion-reduce:transition-none';

/**
 * The navigation, with the structure of a chat app's sidebar.
 *
 * From `lg` up it is a full-height column on the start edge: the wordmark and a collapse
 * control, a "New run" action at the top, the six sections, the current section's pages
 * under them, the recent runs, and the theme at the foot. Collapsed, it is a rail of icons
 * whose labels stay in the accessibility tree. Below `lg` the same element is the slim top
 * header — the wordmark, the section's name and the theme — and the sections move to the
 * bottom bar.
 */
export function NavBar(): React.ReactElement {
  const path = useCurrentPath();
  const current = sectionOf(path);
  const page = routeFor(path);
  const pages = useSectionPages(current);
  const recents = useRecentRuns();
  const [collapsed, toggle] = useCollapsed();
  const currentLabel = SECTIONS.find((section) => section.id === current)?.label ?? '';
  const label = (text: string) => <span className={cn(collapsed && 'lg:sr-only')}>{text}</span>;

  return (
    <nav
      data-testid="nav-bar"
      aria-label="Primary navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'relative flex h-14 shrink-0 items-center gap-x-3 border-b border-border bg-surface px-4 sm:px-6',
        'lg:h-full lg:flex-col lg:items-stretch lg:gap-0 lg:border-b-0 lg:px-3 lg:py-3',
        collapsed ? 'lg:w-16 lg:px-2' : 'lg:w-64',
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 lg:mb-3 lg:min-h-11 lg:ps-3 lg:pe-0">
        {/*
          The product's name, and the only place it appears in the chrome: "Lupin." with the
          dot in the accent, the same mark as the site's footer. `aria-hidden` because the
          page's `h1` already names the screen. A collapsed rail has no room for it.
        */}
        <span
          data-testid="nav-wordmark"
          aria-hidden="true"
          className={cn(
            'shrink-0 text-lg font-semibold tracking-tight text-fg',
            collapsed && 'lg:hidden',
          )}
        >
          <span>Lupin</span>
          <span data-wordmark-dot className="text-accent">
            .
          </span>
        </span>
        <button
          type="button"
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus lg:inline-flex"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={18} aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Below `lg` the sections are in the bottom bar; the header names where you are. */}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-muted lg:hidden">
        {currentLabel}
      </span>

      <div className="hidden min-h-0 flex-1 flex-col gap-5 overflow-y-auto lg:flex">
        <Link
          to="/dashboard/runner"
          className={cn(ROW, 'font-medium text-fg hover:bg-surface-muted', FOCUS)}
          title={collapsed ? 'New run' : undefined}
        >
          <Play size={18} aria-hidden="true" className="shrink-0" />
          {label('New run')}
        </Link>

        <ul aria-label="Sections" className="flex flex-col gap-0.5">
          {SECTIONS.map((section) => {
            const Icon = SECTION_ICONS[section.id];
            const active = section.id === current;
            return (
              <li key={section.id}>
                <Link
                  to={section.path}
                  activeOptions={{ exact: true }}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? section.label : undefined}
                  className={cn(
                    ROW,
                    FOCUS,
                    active
                      ? 'bg-surface-muted font-semibold text-fg'
                      : 'font-medium text-fg-muted hover:bg-surface-muted hover:text-fg',
                  )}
                >
                  <Icon
                    size={18}
                    strokeWidth={active ? 2.25 : 1.75}
                    aria-hidden="true"
                    className="shrink-0"
                  />
                  {label(section.label)}
                </Link>
              </li>
            );
          })}
        </ul>

        {collapsed || pages.length === 0 ? null : (
          <ul aria-label={`${currentLabel} pages`} className="flex flex-col gap-0.5 ps-3">
            {pages.map((tab) => {
              const active = page !== undefined && tab.id === page.id;
              return (
                <li key={tab.id}>
                  <Link
                    to={tab.path}
                    activeOptions={{ exact: true }}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center border-s-2 ps-4 pe-3 text-sm transition-colors duration-100 motion-reduce:transition-none',
                      FOCUS,
                      active
                        ? 'border-accent font-semibold text-fg'
                        : 'border-border text-fg-muted hover:text-fg',
                    )}
                  >
                    {tab.tab}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {collapsed || recents.length === 0 ? null : (
          <div className="flex min-h-0 flex-col gap-1">
            <h2 className="px-3 text-xs font-medium text-fg-muted">Recents</h2>
            <ul aria-label="Recent runs" className="flex flex-col gap-0.5">
              {recents.map((run) => (
                <li key={run.id}>
                  <Link
                    to="/dashboard/runs/$runId"
                    params={{ runId: run.id }}
                    title={run.suite ?? run.id}
                    className={cn(
                      ROW,
                      'min-w-0 text-fg-muted hover:bg-surface-muted hover:text-fg',
                      FOCUS,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        run.outcome === 'passed'
                          ? 'bg-success'
                          : run.outcome === 'failed'
                            ? 'bg-danger'
                            : 'bg-border-strong',
                      )}
                    />
                    <span className="truncate font-mono text-xs">
                      {run.suite ?? run.id.slice(0, 8)}
                    </span>
                    <span className="sr-only">{`, ${run.outcome ?? run.phase}`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className={cn('shrink-0 lg:mt-3', collapsed ? 'lg:self-center' : 'lg:ps-1')}>
        <ThemeToggle />
      </div>
    </nav>
  );
}

/**
 * The section's pages, as an underline row. Shown only when the current page is one of
 * the section's tabs — a run detail or a score deep-dive is reached by a link, and a tab
 * row above it would mark nothing as current.
 */
export function SectionTabs(): React.ReactElement | null {
  const path = useCurrentPath();
  const section = sectionOf(path);
  const page = routeFor(path);
  // Called before the early returns below: hooks cannot follow a conditional exit. The role
  // decides only which Settings tabs to draw; the API still enforces who may open each.
  const tabsRef = useSlidingIndicator<HTMLUListElement>(page?.id);
  const role = useViewerRole();
  if (section === null || page === undefined || !('tab' in page)) return null;
  const tabs = section === 'settings' ? visibleTabsOf(section, role) : tabsOf(section);
  if (tabs.length === 0) return null;
  const label = SECTIONS.find((entry) => entry.id === section)?.label ?? '';
  return (
    <nav
      data-testid="section-tabs"
      data-chrome="secondary"
      aria-label={`${label} pages`}
      className="-mx-4 mb-4 shrink-0 overflow-x-auto border-b border-border px-4 sm:-mx-6 sm:mb-6 sm:px-6 lg:hidden"
    >
      <ul ref={tabsRef} className="relative flex gap-1">
        {tabs.map((tab) => {
          const active = tab.id === page.id;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                to={tab.path}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                {...(active ? { [INDICATOR_ACTIVE_ATTRIBUTE]: 'true' } : {})}
                className={cn(
                  'inline-flex min-h-11 items-center px-3 text-sm transition-colors duration-100 motion-reduce:transition-none',
                  FOCUS,
                  active ? 'font-semibold text-fg' : 'font-medium text-fg-muted hover:text-fg',
                )}
              >
                {tab.tab}
              </Link>
            </li>
          );
        })}
        <span aria-hidden="true" className="indicator" />
      </ul>
    </nav>
  );
}

/**
 * The four sections within thumb reach, below `lg`. A flex child of the shell rather than
 * `position: fixed`, so it never covers the last row of a page, with the safe-area inset
 * added beneath it for a phone with a home indicator.
 */
export function BottomTabBar(): React.ReactElement {
  const current = sectionOf(useCurrentPath());
  return (
    <nav
      data-testid="bottom-tab-bar"
      data-chrome="secondary"
      aria-label="Sections"
      className="shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-6">
        {SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.id];
          const active = section.id === current;
          return (
            <li key={section.id}>
              <Link
                to={section.path}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-xs transition-colors',
                  FOCUS,
                  active ? 'font-semibold text-fg' : 'font-medium text-fg-muted hover:text-fg',
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
