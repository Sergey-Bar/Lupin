import React from 'react';
import { cn } from '../../lib/utils.js';
import { StatusDot } from '../StatusDot/StatusDot.js';
import { Metric } from '../Metric/Metric.js';

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

const MARK: Record<HeroVerdict, 'good' | 'warn' | 'bad' | 'unknown'> = {
  go: 'good',
  caution: 'warn',
  'no-go': 'bad',
  unknown: 'unknown',
};

const WORD_TONE: Record<HeroVerdict, string> = {
  go: 'text-success',
  caution: 'text-warning',
  'no-go': 'text-danger',
  unknown: 'text-fg',
};

/**
 * The page's status, as one compact band: a mark, the word in its tone, the one reason, the
 * numbers behind it, and the action at the end. The same flat card as every page surface, so
 * colour is only on the mark and the word: no tinted panel, no coloured edge, no shadow. Depth
 * belongs to the overlays.
 */
export function Hero({
  verdict,
  word,
  reason,
  eyebrow,
  facts,
  children,
  className,
  headingLevel = 1,
}: {
  verdict: HeroVerdict;
  word: string;
  reason: React.ReactNode;
  /** A small label above the word, e.g. "Release readiness · Storefront". */
  eyebrow?: React.ReactNode;
  /** The numbers behind the verdict, shown as a short row: "2 Failing · 146 Passed". */
  facts?: readonly {
    label: string;
    value: string;
    testId?: string;
    unit?: string;
    delta?: number;
    comparedWith?: string;
    lowerIsBetter?: boolean;
  }[];
  /** The action, at the end of the band. */
  children?: React.ReactNode;
  className?: string;
  /** 2 on a page whose title is already its \h1\. */
  headingLevel?: 1 | 2;
}): React.ReactElement {
  const id = React.useId();
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section
      aria-labelledby={id}
      data-verdict={verdict}
      className={cn(
        'flex animate-fade-in flex-col gap-4 rounded-lg border border-border bg-surface px-6 py-5 sm:flex-row sm:items-center sm:gap-8',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {eyebrow === undefined ? null : (
          <p className="text-xs font-medium text-fg-muted">{eyebrow}</p>
        )}
        <div className="flex items-center gap-3">
          <StatusDot status={MARK[verdict]} />
          <Heading id={id} className={cn('text-xl font-semibold', WORD_TONE[verdict])}>
            {word}
          </Heading>
        </div>
        <p className="max-w-measure text-pretty text-sm text-fg">{reason}</p>
      </div>
      {facts === undefined || facts.length === 0 ? null : (
        <ul aria-label="In numbers" className="flex shrink-0 gap-6">
          {facts.map((fact) => (
            <li key={fact.label}>
              <Metric
                label={fact.label}
                value={fact.value}
                {...(fact.testId === undefined ? {} : { testId: fact.testId })}
                {...(fact.unit === undefined ? {} : { unit: fact.unit })}
                {...(fact.delta === undefined ? {} : { delta: fact.delta })}
                {...(fact.comparedWith === undefined ? {} : { comparedWith: fact.comparedWith })}
                {...(fact.lowerIsBetter === undefined ? {} : { lowerIsBetter: fact.lowerIsBetter })}
              />
            </li>
          ))}
        </ul>
      )}
      {children === undefined ? null : <div className="shrink-0">{children}</div>}
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
