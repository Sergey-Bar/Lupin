import React from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  FlaskConical,
  GitBranch,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  ListChecks,
  Radar,
  Settings,
  ShieldCheck,
  Sparkles,
  Wordmark,
  cn,
} from '@lupin/ui';
import type { ApiClient } from '../lib/api.js';
import { SECTIONS, routeFor, routeManifest, type SectionId } from '../route-manifest.js';

function sectionOfId(id: string | undefined): SectionId | undefined {
  return routeManifest.find((route) => route.id === id)?.section;
}
import { useWheelStep } from '../hooks/useWheelStep.js';

/** Whether the sidebar is the icon rail or the full column, kept per browser. */
export const SIDEBAR_KEY = 'lupin-sidebar';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'expanded';
  } catch {
    return true;
  }
}

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
  now: Radar,
  runs: ListChecks,
  tests: FlaskConical,
  health: ShieldCheck,
  delivery: GitBranch,
  settings: Settings,
};

/** The five areas of the pyramid; Settings is pinned at the bottom instead. */
const AREAS = SECTIONS.filter((section) => section.id !== 'settings');

/**
 * `api` is accepted and unused: the sidebar no longer reads anything (the recent-runs list was
 * removed, because the Runs page is that list). Callers keep passing it without a change.
 */
export function SideNav(_props: { api?: ApiClient }): React.ReactElement {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const page = routeFor(path);
  const navigate = useNavigate();
  // A rail by default: five icons and nothing else beside the work, opened when wanted.
  const [collapsed, setCollapsed] = React.useState(readCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
    } catch {
      // A storage that refuses writes keeps the choice for this page only.
    }
  };
  const current = AREAS.findIndex((section) => sectionOfId(page?.id) === section.id);
  const onWheel = useWheelStep(
    AREAS.map((section) => section.path),
    current,
    (to) => void navigate({ to }),
  );
  return (
    <aside
      data-testid="side-nav"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-border bg-surface transition-[width] duration-100 motion-reduce:transition-none lg:flex',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 shrink-0 items-center',
          collapsed ? 'justify-center' : 'justify-between ps-5 pe-2',
        )}
      >
        {collapsed ? null : <Wordmark data-testid="side-wordmark" decorative />}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors duration-100 hover:bg-surface-raised hover:text-fg motion-reduce:transition-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={16} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className={collapsed ? 'flex justify-center pb-2' : 'px-3 pb-2'}>
        <AskButton compact={collapsed} />
      </div>
      <nav
        aria-label="Sidebar"
        className={cn('min-h-0 flex-1 overflow-y-auto pb-4 pt-2', collapsed ? 'px-2' : 'px-3')}
      >
        {/* Turning the wheel over the areas steps to the next or previous one. */}
        <div onWheel={onWheel}>
          {AREAS.map((section) => (
            <div key={section.id} className="pt-1">
              <SideLink
                to={section.path}
                active={sectionOfId(page?.id) === section.id}
                icon={SECTION_ICONS[section.id]}
                compact={collapsed}
              >
                {section.label}
              </SideLink>
            </div>
          ))}
        </div>
      </nav>
      {/* One quiet icon at the bottom, out of the way of the work. */}
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
          aria-current={sectionOfId(page?.id) === 'settings' ? 'page' : undefined}
          className={cn(
            'inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors duration-100 motion-reduce:transition-none',
            sectionOfId(page?.id) === 'settings'
              ? 'bg-surface-muted text-fg'
              : 'text-fg-muted hover:bg-surface-raised hover:text-fg',
            FOCUS,
          )}
        >
          <Settings size={16} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}

function SideLink({
  to,
  active,
  icon: Icon,
  children,
  compact = false,
}: {
  to: string;
  active: boolean;
  icon?: typeof LayoutGrid;
  children: React.ReactNode;
  /** The rail: the icon alone, the name kept for hover and for a screen reader. */
  compact?: boolean;
}): React.ReactElement {
  return (
    <Link
      {...(compact ? { title: String(children) } : {})}
      to={to}
      // Exact: `/dashboard` is a prefix of every page, and prefix matching marked it current everywhere.
      activeOptions={{ exact: true }}
      aria-current={active ? 'page' : undefined}
      className={cn(
        compact ? 'justify-center' : 'px-2',
        'relative flex min-h-9 items-center gap-2.5 rounded-md text-sm transition-colors duration-100 motion-reduce:transition-none',
        FOCUS,
        // The current area: a short accent bar on the leading edge, the one place the violet
        // marks where you are, so the rail reads at a glance and not only by a grey fill.
        active
          ? 'bg-surface-muted font-semibold text-fg before:absolute before:start-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-accent'
          : 'font-medium text-fg-muted hover:bg-surface-raised hover:text-fg',
      )}
    >
      {Icon === undefined ? null : (
        <Icon size={16} aria-hidden="true" className={active ? 'text-accent' : undefined} />
      )}
      <span className={compact ? 'sr-only' : undefined}>{children}</span>
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
