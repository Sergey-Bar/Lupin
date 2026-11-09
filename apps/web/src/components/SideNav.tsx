import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Wordmark, cn } from '@lupin/ui';
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
export function SideNav(): React.ReactElement {
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
        <SideLink to={path} active={current}>
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
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Link
      to={to}
      // Exact: `/dashboard` is a prefix of every page, and prefix matching marked it current everywhere.
      activeOptions={{ exact: true }}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-9 items-center rounded-md px-2 text-sm transition-colors duration-100 motion-reduce:transition-none',
        FOCUS,
        active
          ? 'bg-surface-muted font-semibold text-fg'
          : 'font-medium text-fg-muted hover:bg-surface-raised hover:text-fg',
      )}
    >
      {children}
    </Link>
  );
}
