import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  FlaskConical,
  House,
  LayoutGrid,
  ListChecks,
  Menu,
  Settings,
  ShieldCheck,
  Wordmark,
  X,
  cn,
} from '@lupin/ui';
import { SECTIONS, sectionOf, type SectionId } from '../route-manifest.js';
import { SidebarList } from './SideNav.js';

/**
 * The phone chrome, below `lg`. The desktop sidebar is the chrome above it.
 *
 * - `NavBar` — the top bar: the wordmark, where you are, and the button that opens the
 *   sidebar's own list as a drawer. Every page is in that list, so no tab row is needed.
 * - `BottomTabBar` — the five places within thumb reach.
 *
 * Both read `SECTIONS` and `sectionOf` from the manifest, so there is one answer to "where am
 * I", marked with `aria-current="page"` **and** weight, never with colour alone.
 */

const SECTION_ICONS: Record<SectionId, typeof LayoutGrid> = {
  now: House,
  runs: ListChecks,
  tests: FlaskConical,
  health: ShieldCheck,
  settings: Settings,
};

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

function useCurrentPath(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

export function NavBar(): React.ReactElement {
  const current = sectionOf(useCurrentPath());
  const [open, setOpen] = React.useState(false);
  const opener = React.useRef<HTMLButtonElement>(null);
  const close = React.useCallback(() => {
    setOpen(false);
    opener.current?.focus();
  }, []);
  return (
    <nav
      data-testid="nav-bar"
      aria-label="Primary navigation"
      className="relative flex h-14 shrink-0 items-center gap-x-3 border-b border-border surface-translucent px-4 sm:px-6 lg:hidden"
    >
      <button
        ref={opener}
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-muted hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      {/* `aria-hidden`: the page's own (visually hidden) `h1` names the screen. */}
      <Wordmark data-testid="nav-wordmark" decorative />
      <span
        data-testid="nav-place"
        className="min-w-0 flex-1 truncate text-sm font-medium text-fg-muted"
      >
        {SECTIONS.find((section) => section.id === current)?.label}
      </span>
      {open ? <Drawer onClose={close} /> : null}
    </nav>
  );
}

/**
 * The sidebar's list as a sheet from the leading edge: modal while open, so Tab stays inside
 * it and Escape, the close button, the scrim or following a link put it away and return focus
 * to the button that opened it.
 */
function Drawer({ onClose }: { onClose: () => void }): React.ReactElement {
  const sheet = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    sheet.current?.querySelector<HTMLElement>('a[href], button')?.focus();
    const root = sheet.current;
    if (root === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>('a[href], button')];
      const first = items[0];
      const last = items.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-modal lg:hidden">
      {/* The scrim: a pointer target only; the keyboard closes with Escape. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col border-e border-border surface-translucent shadow-elevation-3 animate-fade-in"
      >
        <div className="flex h-14 shrink-0 items-center justify-between ps-5 pe-2">
          <Wordmark decorative />
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-muted hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <SidebarList className="px-3" onNavigate={onClose} />
      </div>
    </div>
  );
}

/**
 * The five places within thumb reach, below `lg`. A flex child of the shell rather than
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
      className="shrink-0 border-t border-border surface-translucent pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-5">
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
