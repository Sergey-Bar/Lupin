import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';
import { StatusDot, type DotStatus } from '../StatusDot/StatusDot.js';

/** A run or test state as the product says it: a shaped mark, a word, and whether it moves. */
export interface StatusMeaning {
  tone: DotStatus;
  word: string;
  live: boolean;
}

/**
 * Every run phase, run outcome and test status, in one table, so a run's state reads the same
 * on the run list, the run page, Tests and every band. Unstable rather than flaky, because a
 * reader's question is whether to trust the test, not what the CI system calls it.
 */
const MEANINGS: Readonly<Record<string, StatusMeaning>> = {
  passed: { tone: 'good', word: 'Passed', live: false },
  failed: { tone: 'bad', word: 'Failed', live: false },
  flaky: { tone: 'warn', word: 'Unstable', live: false },
  skipped: { tone: 'unknown', word: 'Skipped', live: false },
  blocked: { tone: 'bad', word: 'Blocked', live: false },
  cancelled: { tone: 'unknown', word: 'Cancelled', live: false },
  timed_out: { tone: 'bad', word: 'Timed out', live: false },
  runner_lost: { tone: 'bad', word: 'Runner lost', live: false },
  infra_failed: { tone: 'bad', word: 'Infra failed', live: false },
  config_failed: { tone: 'bad', word: 'Config failed', live: false },
  partial: { tone: 'warn', word: 'Partial', live: false },
  unknown: { tone: 'unknown', word: 'Unknown', live: false },
  queued: { tone: 'unknown', word: 'Queued', live: false },
  assigned: { tone: 'info', word: 'Assigned', live: true },
  preparing: { tone: 'info', word: 'Preparing', live: true },
  running: { tone: 'info', word: 'Running', live: true },
  collecting: { tone: 'info', word: 'Collecting', live: true },
  normalizing: { tone: 'info', word: 'Normalising', live: true },
  analyzing: { tone: 'info', word: 'Analysing', live: true },
  gate_evaluation: { tone: 'info', word: 'Checking gate', live: true },
  complete: { tone: 'good', word: 'Complete', live: false },
};

/** A state's mark and word; an unknown one is named as it is, never drawn as a verdict. */
export function statusOf(state: string | null | undefined): StatusMeaning {
  if (state === null || state === undefined || state === '') {
    return { tone: 'unknown', word: 'Pending', live: false };
  }
  const known = MEANINGS[state.toLowerCase()];
  if (known !== undefined) return known;
  const words = state.replace(/[_-]+/gu, ' ').trim();
  return {
    tone: 'unknown',
    word: words.charAt(0).toUpperCase() + words.slice(1).toLowerCase(),
    live: false,
  };
}

const PILL: Record<DotStatus, string> = {
  good: 'text-success bg-success/10',
  warn: 'text-warning bg-warning/10',
  bad: 'text-danger bg-danger/10',
  info: 'text-info bg-info/10',
  unknown: 'text-fg-muted bg-surface-muted',
};

export interface StatusProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** A run phase, run outcome or test status, as the API spells it. */
  state: string | null | undefined;
  /** `sm` for a table row, `lg` for a status band. */
  size?: 'sm' | 'lg';
}

/**
 * The status pill: a shaped mark and its word on a tint of the tone. Colour is never the only
 * carrier, since the shape (round, diamond, square, hollow) and the word say it too. A state
 * in progress pulses, and stops under `prefers-reduced-motion`.
 */
export const Status = forwardRef<HTMLSpanElement, StatusProps>(
  ({ state, size = 'sm', className, ...props }, ref) => {
    const meaning = statusOf(state);
    return (
      <span
        ref={ref}
        data-status={meaning.tone}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
          size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs',
          PILL[meaning.tone],
          className,
        )}
        {...props}
      >
        <StatusDot status={meaning.tone} live={meaning.live} />
        <span>{meaning.word}</span>
      </span>
    );
  },
);
Status.displayName = 'Status';

/**
 * Whether the page is hearing live updates: a pulsing mark and "Live", or a still one and
 * "Reconnecting". A polite live region, so losing the feed is announced, not just drawn.
 */
export function LiveDot({
  live,
  className,
  ...props
}: { live: boolean; className?: string } & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted',
        className,
      )}
      {...props}
    >
      <StatusDot status={live ? 'good' : 'warn'} live={live} />
      <span>{live ? 'Live' : 'Reconnecting'}</span>
    </span>
  );
}
