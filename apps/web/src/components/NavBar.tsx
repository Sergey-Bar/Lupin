import React from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  FlaskConical,
  GitBranch,
  INDICATOR_ACTIVE_ATTRIBUTE,
  LayoutGrid,
  ListChecks,
  Radar,
  Settings,
  ShieldCheck,
  cn,
  useSlidingIndicator,
  Wordmark,
} from '@lupin/ui';
import {
  SECTIONS,
  routeFor,
  sectionOf,
  groupOf,
  tabGroups,
  tabsOf,
  visibleTabsOf,
  type SectionId,
} from '../route-manifest.js';
import { useViewerRole } from '../hooks/useViewerRole.js';
import { useWheelStep } from '../hooks/useWheelStep.js';

/**
 * The chrome: four sections, three surfaces.
 *
 * - `NavBar` — the top bar. The wordmark and where you are. The theme is set in Settings.
 * - `SectionTabs` — the tab row under it, for a section with more than one page.
 * - `BottomTabBar` — the four sections as a thumb-reach tab bar below `lg`.
 *
 * All three read `SECTIONS` and `sectionOf` from the manifest, so there is one answer to
 * "where am I". The current section is marked with `aria-current="page"` **and** with
 * weight and a rule, never with colour alone.
 *
 * **No Logout button.** The install is open, so there is no session to end.
 */

const SECTION_ICONS: Record<SectionId, typeof LayoutGrid> = {
  now: Radar,
  runs: ListChecks,
  tests: FlaskConical,
  health: ShieldCheck,
  delivery: GitBranch,
  settings: Settings,
};

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

function useCurrentPath(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

export function NavBar(): React.ReactElement {
  const current = sectionOf(useCurrentPath());
  const listRef = useSlidingIndicator<HTMLUListElement>(current);
  return (
    <nav
      data-testid="nav-bar"
      aria-label="Primary navigation"
      className="relative flex h-14 shrink-0 items-center gap-x-6 border-b border-border bg-surface px-4 sm:px-6 lg:hidden"
    >
      {/*
        The product's name, and the only place it appears in the chrome: "Lupin." with the
        dot in the accent, the same mark as the site's footer. `aria-hidden` because the
        page's `h1` already names the screen.
      */}
      <Wordmark data-testid="nav-wordmark" decorative />
      {/* The accent mark slides between sections (`indicator`, motion.css) rather than jumping. */}
      <ul
        ref={listRef}
        className="relative hidden min-w-0 flex-1 items-center justify-center gap-x-1 lg:flex"
      >
        {SECTIONS.map((section) => {
          const active = section.id === current;
          return (
            <li key={section.id}>
              <Link
                to={section.path}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                {...(active ? { [INDICATOR_ACTIVE_ATTRIBUTE]: 'true' } : {})}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-md px-4 text-sm transition-colors duration-100 motion-reduce:transition-none',
                  FOCUS,
                  active ? 'font-semibold text-fg' : 'font-medium text-fg-muted hover:text-fg',
                )}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
        <span aria-hidden="true" className="indicator" />
      </ul>
      {/* Below `lg` the sections are in the bottom bar; the top bar names where you are. */}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-muted lg:hidden">
        {SECTIONS.find((section) => section.id === current)?.label}
      </span>
    </nav>
  );
}

/**
 * The section's pages, as an underline row, at every width: the sidebar lists the six areas
 * and nothing under them, so this row is the only way to the other pages of an area. Shown
 * only when the current page is one of the section's tabs — a run detail or a score
 * deep-dive is reached by a link, and a tab row above it would mark nothing as current.
 */
export function SectionTabs(): React.ReactElement | null {
  const path = useCurrentPath();
  const section = sectionOf(path);
  const page = routeFor(path);
  // Called before the early returns below: hooks cannot follow a conditional exit. The role
  // decides only which Settings tabs to draw; the API still enforces who may open each.
  const tabsRef = useSlidingIndicator<HTMLUListElement>(page?.id);
  const role = useViewerRole();
  // A row wider than the screen (Settings, for an admin) must not hide the page you are on.
  React.useEffect(() => {
    document
      .querySelector<HTMLElement>('[data-testid="section-tabs"] [aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [page?.id, role]);
  if (section === null || page === undefined || !('tab' in page)) return null;
  const tabs = section === 'settings' ? visibleTabsOf(section, role) : tabsOf(section);
  if (tabs.length === 0) return null;
  const label = SECTIONS.find((entry) => entry.id === section)?.label ?? '';
  return <WheelTabs tabs={tabs} pageId={page.id} label={label} tabsRef={tabsRef} />;
}

/** The row itself, split out so the wheel hook is called after the early returns above. */
function WheelTabs({
  tabs,
  pageId,
  label,
  tabsRef,
}: {
  tabs: ReturnType<typeof tabsOf>;
  pageId: string;
  label: string;
  tabsRef: React.Ref<HTMLUListElement>;
}): React.ReactElement {
  const navigate = useNavigate();
  const onWheel = useWheelStep(
    tabs.map((tab) => tab.path),
    tabs.findIndex((tab) => tab.id === pageId),
    (to) => void navigate({ to }),
  );
  const page = { id: pageId };
  return (
    <nav
      data-testid="section-tabs"
      data-chrome="secondary"
      aria-label={`${label} pages`}
      onWheel={onWheel}
      className="-mx-4 mb-4 shrink-0 overflow-x-auto border-b border-border px-4 sm:-mx-6 sm:mb-6 sm:px-6"
    >
      <ul ref={tabsRef} className="relative flex gap-1">
        {tabGroups(tabs).flatMap((group, groupIndex) => [
          ...(groupIndex === 0
            ? []
            : [
                <li
                  key={`divider-${String(groupIndex)}`}
                  aria-hidden="true"
                  data-tab-divider=""
                  className="mx-1 my-3 w-px shrink-0 bg-border"
                />,
              ]),
          ...(() => {
            const links = group.map((tab) => {
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
            });
            const name = group[0] === undefined ? undefined : groupOf(group[0]);
            if (name === undefined) return links;
            // A named group (Settings): a quiet label, then its tabs, as one named list so a
            // screen reader hears "Workspace" before the tabs in it.
            return [
              <li key={`group-${name}`} className="flex shrink-0 items-center">
                <span
                  data-tab-group=""
                  aria-hidden="true"
                  className="pe-1 ps-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-muted"
                >
                  {name}
                </span>
                <ul role="group" aria-label={name} className="flex gap-1">
                  {links}
                </ul>
              </li>,
            ];
          })(),
        ])}
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
