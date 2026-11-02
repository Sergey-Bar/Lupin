import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronDown } from '../../icons.js';
import { cn } from '../../lib/utils.js';

export interface MenuButtonItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MenuButtonProps {
  /** What the trigger does, for assistive technology: "Actions for octo/service#1". */
  label: string;
  /** What the trigger shows. Defaults to the word "Actions" and a chevron. */
  children?: ReactNode;
  items: readonly MenuButtonItem[];
  onSelect: (value: string) => void;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** The gap kept between the menu and the edge of the window. */
const EDGE = 8;

/**
 * A button that opens a list of actions.
 *
 * ## Why this is not a `<select>`
 *
 * A native select is a control for choosing a *value*; a row's "Actions" is a list of verbs, and
 * the browser draws a select's list with its own chrome, outside the design system, with no
 * motion and no way to style a disabled item. This is the WAI-ARIA menu button pattern: the
 * trigger has `aria-haspopup="menu"`, the list is `role="menu"` of `role="menuitem"`, focus moves
 * into the list on open and back to the trigger on close, and arrows, Home, End, Escape and Tab
 * do what a menu's keys do.
 *
 * ## Why the list is `position: fixed`
 *
 * The menu opens from rows inside panels that scroll (`overflow-auto`), and an absolutely
 * positioned list inside one is clipped by it. A fixed list is placed from the trigger's
 * rectangle when it opens, flipped above the trigger when there is no room below, and closed on
 * scroll or resize rather than left floating where its trigger used to be.
 *
 * The list is an overlay, so it uses the `surface-translucent` material and the anchored
 * `animate-zoom-in-95` entrance, and nothing else on the page does.
 */
export function MenuButton({
  label,
  children,
  items,
  onSelect,
  disabled = false,
  className,
  'data-testid': testId,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  const enabled = items.filter((item) => item.disabled !== true);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  /** Place the list from the trigger, before paint, so it never shows in the wrong spot. */
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (trigger === null || list === null) return;
    const anchor = trigger.getBoundingClientRect();
    const height = list.offsetHeight;
    const width = list.offsetWidth;
    const below = anchor.bottom + 4;
    const fitsBelow = below + height <= window.innerHeight - EDGE;
    const top = fitsBelow ? below : Math.max(EDGE, anchor.top - 4 - height);
    // Align the list's end edge with the trigger's, whichever way the text runs.
    const rtl = getComputedStyle(trigger).direction === 'rtl';
    const left = rtl ? anchor.left : anchor.right - width;
    setPlacement({
      top,
      left: Math.min(Math.max(EDGE, left), Math.max(EDGE, window.innerWidth - width - EDGE)),
    });
  }, [open]);

  /** Focus the first enabled item once the list exists. */
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open, placement]);

  /** Close for anything that would leave the list stranded or ambiguous. */
  useEffect(() => {
    if (!open) return;
    const away = (event: Event): void => {
      const target = event.target as Node | null;
      if (
        target !== null &&
        (listRef.current?.contains(target) || triggerRef.current?.contains(target))
      ) {
        return;
      }
      close(false);
    };
    const leave = (): void => close(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', leave);
    window.addEventListener('scroll', leave, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('resize', leave);
      window.removeEventListener('scroll', leave, true);
    };
  }, [open, close]);

  const move = (from: HTMLElement | null, step: 1 | -1 | 'first' | 'last'): void => {
    const nodes = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ??
        []),
    ];
    if (nodes.length === 0) return;
    const index = from === null ? -1 : nodes.indexOf(from);
    const next =
      step === 'first'
        ? 0
        : step === 'last'
          ? nodes.length - 1
          : (index + step + nodes.length) % nodes.length;
    nodes[next]?.focus();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = (event.target as HTMLElement).closest<HTMLElement>('[role="menuitem"]');
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(current, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(current, -1);
        break;
      case 'Home':
        event.preventDefault();
        move(current, 'first');
        break;
      case 'End':
        event.preventDefault();
        move(current, 'last');
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        // A menu is not a tab stop: Tab leaves it, and focus goes where Tab was going.
        close(false);
        break;
      default:
    }
  };

  return (
    <span className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || enabled.length === 0}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-testid={testId}
        onClick={() => {
          setPlacement(null);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setPlacement(null);
            setOpen(true);
          }
        }}
        className={cn(
          'inline-flex h-9 min-w-24 items-center justify-between gap-1.5 rounded-md border border-border-strong bg-transparent px-3 text-sm text-fg',
          'transition-colors duration-100 motion-reduce:transition-none hover:bg-surface-muted active:scale-press',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        {children ?? 'Actions'}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn(
            'shrink-0 text-fg-muted transition-transform duration-150 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <div
          ref={listRef}
          id={id}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          onKeyDown={onListKeyDown}
          style={placement ?? { top: 0, left: 0, visibility: 'hidden' }}
          className="surface-translucent fixed z-popover min-w-44 origin-top animate-zoom-in-95 rounded-md border border-border p-1 shadow-elevation-2"
        >
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitem"
              disabled={item.disabled === true}
              tabIndex={-1}
              onClick={() => {
                close(true);
                onSelect(item.value);
              }}
              className="flex min-h-9 w-full items-center rounded-sm px-3 text-start text-sm text-fg transition-colors duration-100 hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
