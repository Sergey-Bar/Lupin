import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Activity, GitBranch, LayoutGrid, ListChecks, Network, Settings, cn } from '@lupin/ui';
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
 * The chrome is one minimal sidebar. The console is a desktop product, so there is no phone
 * header, no tab row and no bottom bar.
 *
 * Every section is listed with **all** of its pages, always expanded, in one list that scrolls
 * inside the sidebar, so any page is one click away and a reader can scroll from one category to
 * the next without opening it first. The wordmark sits at the top and the theme at the foot;
 * nothing else competes with the list.
 *
 * It reads `SECTIONS`, `tabsOf` and `sectionOf` from the manifest, so there is one answer to
 * "where am I". The current section and page carry `aria-current="page"` **and** weight, never
 * colour alone.
 */

const SECTION_ICONS: Record<SectionId, typeof LayoutGrid> = {
  overview: LayoutGrid,
  runs: ListChecks,
  insights: Activity,
  map: Network,
  github: GitBranch,
  settings: Settings,
};

/** Inset (`[-2px]`), because the scrolling list would clip a ring drawn outside the row. */
const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-focus';

const ROW =
  'flex min-h-9 items-center rounded-md px-3 text-sm transition-colors duration-100 motion-reduce:transition-none';

export function NavBar(): React.ReactElement {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const current = sectionOf(path);
  const page = routeFor(path);
  const role = useViewerRole();

  return (
    <nav
      data-testid="nav-bar"
      aria-label="Primary navigation"
      className="flex h-full w-60 shrink-0 flex-col border-e border-border bg-surface"
    >
      {/*
        The product's name, and the only place it appears in the chrome: "Lupin." with the dot
        in the accent, the same mark as the site's footer. `aria-hidden` because the page's
        `h1` already names the screen.
      */}
      <span
        data-testid="nav-wordmark"
        aria-hidden="true"
        className="shrink-0 px-6 pt-6 pb-4 text-lg font-semibold tracking-tight text-fg"
      >
        <span>Lupin</span>
        <span data-wordmark-dot className="text-accent">
          .
        </span>
      </span>

      <div
        data-testid="nav-scroll"
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]"
      >
        <ul aria-label="Sections" className="flex flex-col gap-5">
          {SECTIONS.map((section) => {
            const Icon = SECTION_ICONS[section.id];
            const active = section.id === current;
            const pages =
              section.id === 'settings' ? visibleTabsOf(section.id, role) : tabsOf(section.id);
            return (
              <li key={section.id} className="flex flex-col gap-0.5">
                <Link
                  to={section.path}
                  activeOptions={{ exact: true }}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    ROW,
                    'gap-2.5',
                    FOCUS,
                    active ? 'font-semibold text-fg' : 'font-medium text-fg-muted hover:text-fg',
                  )}
                >
                  <Icon
                    size={16}
                    strokeWidth={active ? 2.25 : 1.75}
                    aria-hidden="true"
                    className="shrink-0"
                  />
                  {section.label}
                </Link>
                {pages.length === 0 ? null : (
                  <ul aria-label={`${section.label} pages`} className="flex flex-col">
                    {pages.map((tab) => {
                      const here = page !== undefined && tab.id === page.id;
                      return (
                        <li key={tab.id}>
                          <Link
                            to={tab.path}
                            activeOptions={{ exact: true }}
                            aria-current={here ? 'page' : undefined}
                            className={cn(
                              ROW,
                              'ps-9',
                              FOCUS,
                              here
                                ? 'bg-surface-muted font-medium text-fg'
                                : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
                            )}
                          >
                            {tab.tab}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2">
        <ThemeToggle />
      </div>
    </nav>
  );
}
