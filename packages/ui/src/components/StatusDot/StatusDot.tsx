import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export type DotStatus = 'good' | 'warn' | 'bad' | 'info' | 'unknown';

/*
 * Each verdict is a solid core in a soft halo of its own tone (a ring, so it takes no
 * layout space), and each has its own shape: round for passing, a diamond for a warning,
 * a square for a failure. Colour is never the only carrier, even without the label.
 */
const TONE: Record<DotStatus, string> = {
  good: 'rounded-full bg-success ring-3 ring-success/20',
  warn: 'h-1.5 w-1.5 rotate-45 rounded-xs bg-warning ring-3 ring-warning/20',
  bad: 'rounded-xs bg-danger ring-3 ring-danger/20',
  info: 'rounded-full bg-info ring-3 ring-info/20',
  // Hollow, so "we do not know" never reads as a fourth verdict colour.
  unknown: 'rounded-full ring-1 ring-fg-muted',
};

export interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: DotStatus;
  /**
   * The status in words, for a dot that stands alone. Without it the dot is decorative and
   * the caller must put the same word beside it — colour is never the only carrier.
   */
  label?: string;
  /** A pulse for something in progress. Stops under `prefers-reduced-motion`. */
  live?: boolean;
}

/**
 * The one place a verdict colour is drawn as a mark.
 *
 * Eight pixels, round, from the status token. The monochrome plane means this dot is very
 * often the only colour in a row, so it is what the eye finds first — and it is always
 * paired with a word, either the caller's or its own `aria-label`.
 */
export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ status, label, live = false, className, ...props }, ref) => (
    <span
      ref={ref}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      className={cn(
        'inline-block h-2 w-2 shrink-0',
        TONE[status],
        live && 'animate-lupin-pulse motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  ),
);
StatusDot.displayName = 'StatusDot';
