import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  House,
  LayoutGrid,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  Wordmark,
  cn,
} from '@lupin/ui';
import type { ApiClient } from '../lib/api.js';
import {
  navTree,
  routeFor,
  sectionOf,
  type NavGroup,
  type NavPage,
  type SectionId,
} from '../route-manifest.js';
import { useViewerRole } from '../hooks/useViewerRole.js';

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
export function SideNav(_props: { api?: ApiClient }): React.ReactElement {
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
      <SidebarList collapsed={collapsed} className={collapsed ? 'px-2' : 'px-3'} />
      {settingsMode ? null : <SettingsFoot collapsed={collapsed} />}
    </aside>
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
  collapsed = false,
  className,
  onNavigate,
}: {
  collapsed?: boolean;
  className?: string;
  /** Called after a link is followed; the drawer closes itself. */
  onNavigate?: () => void;
}): React.ReactElement {
  const { pageId, section } = useCurrentPage();
  const role = useViewerRole();
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
    <AppList
      groups={tree.filter((group) => group.id !== 'settings')}
      pageId={pageId}
      section={section}
      collapsed={collapsed}
      className={className}
      onNavigate={onNavigate}
    />
  );
}

function AppList({
  groups,
  pageId,
  section,
  collapsed,
  className,
  onNavigate,
}: {
  groups: NavGroup[];
  pageId: string | undefined;
  section: SectionId | null;
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
        {groups.map((group) => (
          <PlaceGroup
            key={group.id}
            group={group}
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
        ))}
      </ul>
    </nav>
  );
}

function PlaceGroup({
  group,
  pageId,
  here,
  open,
  collapsed,
  onFlip,
  onClose,
  onNavigate,
}: {
  group: NavGroup;
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
        aria-label={group.label}
        onClick={onFlip}
        className={cn(
          collapsed ? 'justify-center' : 'px-2',
          'flex min-h-9 w-full items-center gap-2.5 rounded-md text-sm transition-colors duration-100 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          here
            ? 'font-semibold text-fg'
            : 'font-medium text-fg-muted hover:bg-surface-raised hover:text-fg',
        )}
      >
        <Icon size={16} aria-hidden="true" className={here ? 'text-accent' : undefined} />
        {collapsed ? null : (
          <>
            <span className="flex-1 text-start">{group.label}</span>
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
              <PageLink page={page} current={page.id === pageId} onNavigate={onNavigate} />
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
  current,
  onNavigate,
}: {
  page: NavPage;
  current: boolean;
  onNavigate?: (() => void) | undefined;
}): React.ReactElement {
  return (
    <Link
      to={page.path}
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
