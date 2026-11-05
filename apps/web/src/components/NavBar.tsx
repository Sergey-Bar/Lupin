import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  Activity,
  GitBranch,
  INDICATOR_ACTIVE_ATTRIBUTE,
  LayoutGrid,
  ListChecks,
  Network,
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

/**
 * The chrome: an icon-only rail and a tab row. The console is a desktop product, so there is no
 * phone header and no bottom bar.
 *
 * - `NavBar` — a narrow rail on the start edge: the wordmark's dot, one icon per section, the
 *   theme at the foot. Each icon is a named link (visually hidden label plus a `title` tooltip),
 *   so the rail is minimal to the eye and complete to a screen reader.
 * - `SectionTabs` — the current section's pages, as a tab row above the page.
 *
 * Both read `SECTIONS` and `sectionOf` from the manifest, so there is one answer to "where am
 * I". The current section carries `aria-current="page"` **and** a filled tile, never colour alone.
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

export function NavBar(): React.ReactElement {
  const current = sectionOf(useCurrentPath());
  return (
    <nav
      data-testid="nav-bar"
      aria-label="Primary navigation"
      className="flex h-full w-16 shrink-0 flex-col items-center border-e border-border bg-surface py-4"
    >
      {/*
        The product's mark, and the only place it appears in the chrome. The rail is too narrow
        for the name, so it is the initial with the accent dot. `aria-hidden` because the page's
        `h1` already names the screen.
      */}
      <span
        data-testid="nav-wordmark"
        aria-hidden="true"
        title="Lupin"
        className="mb-6 shrink-0 text-lg font-semibold tracking-tight text-fg"
      >
        <span>L</span>
        <span data-wordmark-dot className="text-accent">
          .
        </span>
      </span>

      <ul aria-label="Sections" className="flex min-h-0 flex-1 flex-col items-center gap-1">
        {SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.id];
          const active = section.id === current;
          return (
            <li key={section.id}>
              <Link
                to={section.path}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                title={section.label}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-lg transition-colors duration-100 motion-reduce:transition-none',
                  FOCUS,
                  active
                    ? 'bg-surface-muted text-fg'
                    : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                <span className="sr-only">{section.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <ThemeToggle />
    </nav>
  );
}

/**
 * The section's pages, as an underline row above the page. Shown only when the current page is
 * one of the section's tabs — a run detail is reached by a link, and a tab row above it would
 * mark nothing as current.
 */
export function SectionTabs(): React.ReactElement | null {
  const path = useCurrentPath();
  const section = sectionOf(path);
  const page = routeFor(path);
  // Called before the early returns below: hooks cannot follow a conditional exit.
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
      className="-mx-10 mb-6 shrink-0 overflow-x-auto border-b border-border px-10"
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
