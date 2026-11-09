import React from 'react';
import { cn } from '../../lib/utils.js';
import { StatusDot } from '../StatusDot/StatusDot.js';

/**
 * Kit v2 (design language v2): the four pieces every redesigned page is made of.
 *
 * - `Surface` — a plane at one of three elevations. Depth is a solid step of the plane, never
 *   glass: `backdrop-filter` stays on the four overlays.
 * - `Hero` — the one verdict a page leads with, Tesla-style: a large word in the display face
 *   on its verdict glow, one reason, and whatever the page puts under it (a chart, an action).
 * - `Row` — a titled horizontal list, Netflix-style, that a reader walks with the arrow keys one
 *   card at a time. An empty row draws nothing.
 * - `ActionCard` — one thing to do: its verdict as a dot *and* a word, one fact, one button.
 */

const ELEVATION = { 1: 'bg-elevation-1', 2: 'bg-elevation-2', 3: 'bg-elevation-3' } as const;

export function Surface({
  level = 1,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { level?: 1 | 2 | 3 }): React.ReactElement {
  return (
    <div
      className={cn(ELEVATION[level], 'rounded-lg border border-border', className)}
      {...props}
    />
  );
}

export type HeroVerdict = 'go' | 'caution' | 'no-go' | 'unknown';

const GLOW: Record<HeroVerdict, string> = {
  go: 'bg-glow-go',
  caution: 'bg-glow-caution',
  'no-go': 'bg-glow-no-go',
  unknown: 'bg-elevation-1',
};

const WORD_TONE: Record<HeroVerdict, string> = {
  go: 'text-success',
  caution: 'text-warning',
  'no-go': 'text-danger',
  unknown: 'text-fg',
};

export function Hero({
  verdict,
  word,
  reason,
  eyebrow,
  children,
  className,
}: {
  verdict: HeroVerdict;
  word: string;
  reason: React.ReactNode;
  /** A small label above the word, e.g. "Release readiness · Storefront". */
  eyebrow?: React.ReactNode;
  /** What sits under the reason: the background chart, the action. */
  children?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      data-verdict={verdict}
      className={cn(
        GLOW[verdict],
        'relative isolate flex animate-reveal flex-col gap-4 overflow-hidden rounded-lg border border-border px-6 py-10 sm:px-10 sm:py-14',
        className,
      )}
    >
      {eyebrow === undefined ? null : (
        <p className="text-sm font-medium text-fg-muted">{eyebrow}</p>
      )}
      <h1
        id={id}
        className={cn(
          'font-display text-6xl leading-tight tracking-tight sm:text-8xl',
          WORD_TONE[verdict],
        )}
      >
        {word}
      </h1>
      <p className="max-w-measure text-pretty text-lg text-fg sm:text-xl">{reason}</p>
      {children}
    </section>
  );
}

export function Row({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode[];
  className?: string;
}): React.ReactElement | null {
  const items = React.Children.toArray(children);
  const listRef = React.useRef<HTMLUListElement>(null);
  // One native listener on the list rather than a handler per item: the items are not controls,
  // the cards inside them are, and the list only moves focus between them.
  React.useEffect(() => {
    const list = listRef.current;
    if (list === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const from = (event.target as HTMLElement).closest('li');
      if (from === null || from.parentElement !== list) return;
      event.preventDefault();
      step(from, event.key === 'ArrowRight' ? 1 : -1);
    };
    list.addEventListener('keydown', onKey);
    return () => list.removeEventListener('keydown', onKey);
  });
  if (items.length === 0) return null;
  const step = (from: HTMLElement, by: 1 | -1) => {
    const all = [...(listRef.current?.querySelectorAll<HTMLElement>(':scope > li') ?? [])];
    const next = all[all.indexOf(from) + by];
    if (next === undefined) return;
    next.focus();
    next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
      <ul
        ref={listRef}
        aria-label={title}
        className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2"
      >
        {items.map((item, index) => (
          <li
            // A row's children come in order and are not reordered, so the index is stable.
            key={index}
            tabIndex={-1}
            className="w-72 shrink-0 snap-start rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export type CardTone = 'bad' | 'warn' | 'good' | 'info';

const TONE_WORD: Record<CardTone, string> = {
  bad: 'Needs you',
  warn: 'Worth a look',
  good: 'Fine',
  info: 'For context',
};

export function ActionCard({
  tone,
  title,
  fact,
  action,
  onAct,
  primary = false,
}: {
  tone: CardTone;
  title: string;
  fact: string;
  action: string;
  onAct: () => void;
  /** The page's one main action: the solid button and the A shortcut. */
  primary?: boolean;
}): React.ReactElement {
  const id = React.useId();
  return (
    <article
      aria-labelledby={id}
      className="flex h-full flex-col gap-3 rounded-lg border border-border bg-elevation-2 p-4 transition-colors duration-100 hover:border-border-strong motion-reduce:transition-none"
    >
      <p className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        <StatusDot status={tone === 'warn' ? 'warn' : tone} />
        {TONE_WORD[tone]}
      </p>
      <h3 id={id} className="line-clamp-2 text-base font-semibold text-fg">
        {title}
      </h3>
      <p className="text-sm text-fg-muted">{fact}</p>
      <button
        type="button"
        onClick={onAct}
        {...(primary ? { 'data-primary': 'true', 'aria-keyshortcuts': 'a' } : {})}
        className={cn(
          'mt-auto inline-flex min-h-10 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors duration-100 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          primary
            ? 'bg-primary text-on-fill hover:opacity-90'
            : 'border border-border-strong text-fg hover:bg-surface-muted',
        )}
      >
        {action}
      </button>
    </article>
  );
}
