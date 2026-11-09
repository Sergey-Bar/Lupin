import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  Activity,
  GitBranch,
  LayoutGrid,
  ListChecks,
  Network,
  Settings,
  Sparkles,
  StatusDot,
  Wordmark,
  cn,
} from '@lupin/ui';
import { defaultApiClient, type ApiClient } from '../lib/api.js';
import { useResource } from '../hooks/useResource.js';
import { statusWord } from '../lib/status-word.js';
import { Timestamp } from './Timestamp.js';
import {
  SECTIONS,
  routeFor,
  routeManifest,
  tabsOf,
  visibleTabsOf,
  type SectionId,
} from '../route-manifest.js';

function sectionOfId(id: string | undefined): SectionId | undefined {
  return routeManifest.find((route) => route.id === id)?.section;
}
import { ThemeToggle } from './ThemeToggle.js';
import { useViewerRole } from '../hooks/useViewerRole.js';

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

/**
 * The desktop chrome: one compact column with every section and every tab in it.
 *
 * It replaces the top bar's section row and the tab row under it from `lg` up, so a page is
 * one click from any other and the reader never has to open a section to find what is in it.
 * The column is `sticky` at the full window height and scrolls its own list, so it stays put
 * while the page scrolls and still reaches the bottom of a long section list on a short screen.
 * Below `lg` it is hidden; the top bar and the bottom tab bar take over.
 */
const SECTION_ICONS: Record<SectionId, typeof LayoutGrid> = {
  overview: LayoutGrid,
  runs: ListChecks,
  insights: Activity,
  map: Network,
  github: GitBranch,
  settings: Settings,
};

const RECENT = 5;

export function SideNav({ api = defaultApiClient }: { api?: ApiClient }): React.ReactElement {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const page = routeFor(path);
  const role = useViewerRole();
  return (
    <aside
      data-testid="side-nav"
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-border bg-surface lg:flex"
    >
      <div className="flex h-14 shrink-0 items-center px-5">
        <Wordmark data-testid="side-wordmark" decorative />
      </div>
      <div className="px-3 pb-2">
        <AskButton />
      </div>
      <nav aria-label="Sidebar" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {SECTIONS.map((section) => (
          <SectionGroup
            key={section.id}
            id={section.id}
            label={section.label}
            path={section.path}
            currentId={page?.id}
            role={role}
          />
        ))}
        <RecentRuns api={api} />
      </nav>
      <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
        <span className="text-xs text-fg-muted">Theme</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}

/**
 * One section: a single link when you are elsewhere, and its pages listed under it when you are
 * in it. Six lines to read instead of twenty-six, and the pages you are working among stay one
 * click apart.
 */
function SectionGroup({
  id,
  label,
  path,
  currentId,
  role,
}: {
  id: SectionId;
  label: string;
  path: string;
  currentId: string | undefined;
  role: ReturnType<typeof useViewerRole>;
}): React.ReactElement {
  const tabs = id === 'settings' ? visibleTabsOf(id, role) : tabsOf(id);
  const current = sectionOfId(currentId) === id;
  if (!current || tabs.length === 0) {
    return (
      <div className="pt-1">
        <SideLink to={path} active={current} icon={SECTION_ICONS[id]}>
          {label}
        </SideLink>
      </div>
    );
  }
  return (
    <section className="pt-1" aria-labelledby={`side-${id}`}>
      <span
        id={`side-${id}`}
        className="flex min-h-9 items-center px-2 text-sm font-semibold text-fg"
      >
        {label}
      </span>
      <ul className="ms-2 flex flex-col gap-px border-s border-border ps-2">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <SideLink to={tab.path} active={tab.id === currentId}>
              {tab.tab}
            </SideLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
function SideLink({
  to,
  active,
  icon: Icon,
  children,
}: {
  to: string;
  active: boolean;
  icon?: typeof LayoutGrid;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Link
      to={to}
      // Exact: `/dashboard` is a prefix of every page, and prefix matching marked it current everywhere.
      activeOptions={{ exact: true }}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-9 items-center gap-2.5 rounded-md px-2 text-sm transition-colors duration-100 motion-reduce:transition-none',
        FOCUS,
        active
          ? 'bg-surface-muted font-semibold text-fg'
          : 'font-medium text-fg-muted hover:bg-surface-raised hover:text-fg',
      )}
    >
      {Icon === undefined ? null : <Icon size={16} aria-hidden="true" />}
      {children}
    </Link>
  );
}

/**
 * The one primary action, at the top like Codex's "New task": ask Lupin anything, which opens
 * the command palette. It sends the same Ctrl+K the palette already listens for, so there is
 * one way in and no second palette state to keep in step.
 */
function AskButton(): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() =>
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
        )
      }
      className={cn(
        'flex min-h-10 w-full items-center gap-2.5 rounded-md bg-surface-raised px-3 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-muted motion-reduce:transition-none',
        FOCUS,
      )}
    >
      <Sparkles size={16} aria-hidden="true" className="text-accent" />
      <span className="flex-1 text-start">Ask Lupin</span>
      <kbd className="rounded border border-border px-1.5 font-mono text-xs text-fg-muted">⌘K</kbd>
    </button>
  );
}

/** The latest runs, newest first, as Codex lists recent tasks: a dot, the branch, and when. */
function RecentRuns({ api }: { api: ApiClient }): React.ReactElement {
  const runs = useResource(() => api.getRecentRuns(RECENT), [api]);
  const recent =
    runs.status === 'ready'
      ? [...runs.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RECENT)
      : [];
  return (
    <div className="pt-6">
      <p className="px-2 pb-1 text-xs font-medium text-fg-muted">Recent</p>
      {runs.status === 'ready' && recent.length === 0 ? (
        <p className="px-2 py-1 text-sm text-fg-muted">No runs yet</p>
      ) : (
        <ul aria-label="Recent runs" className="flex flex-col gap-px">
          {recent.map((run) => (
            <li key={run.id}>
              <Link
                to="/dashboard/runs/$runId"
                params={{ runId: run.id }}
                className={cn(
                  'flex min-h-9 items-center gap-2.5 rounded-md px-2 text-sm text-fg-muted transition-colors duration-100 hover:bg-surface-raised hover:text-fg motion-reduce:transition-none',
                  FOCUS,
                )}
              >
                <StatusDot
                  status={
                    run.outcome === 'failed' ? 'bad' : run.outcome === 'passed' ? 'good' : 'unknown'
                  }
                  label={statusWord(run.outcome)}
                />
                <span className="min-w-0 flex-1 truncate">{run.branch ?? run.id.slice(0, 8)}</span>
                <span className="shrink-0 text-xs text-fg-muted">
                  <Timestamp value={run.createdAt} empty="" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
