import React from 'react';
import { Badge, Button, EmptyState, Skeleton } from '@lupin/ui';
import type { DeliverySummary, Portfolio } from '@lupin/shared-contracts';
import type { Run } from '../lib/api.js';
import { isNew, rankAttention, type AttentionItem } from '../lib/attention.js';
import { ago } from '../lib/health-view.js';
import { useCommandActions } from '../hooks/useCommandActions.js';

/**
 * What needs you now: at most five items, worst first, each with one button. "All clear" when
 * there is nothing, which is the answer most mornings and deserves to be said plainly. Anything
 * that happened since the last visit is marked, so a returning person sees what changed
 * without reading everything again. It is the section under the cockpit.
 */
export interface NowSources {
  runs: () => Promise<Run[]>;
  portfolio: () => Promise<Portfolio>;
  deliveries: () => Promise<DeliverySummary[]>;
}

function sentenceOf(total: number): string {
  if (total === 0) return 'Nothing needs you now';
  return total === 1 ? '1 thing needs you now' : `${String(total)} things need you now`;
}

export const LAST_VISIT_KEY = 'lupin-now-last-visit';

interface Ready {
  status: 'ready';
  items: AttentionItem[];
  total: number;
  partial: boolean;
}

/** Each source is optional: a failed read hides its items and says so, not the page. */
async function settle<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

async function readAttention(sources: NowSources, now: Date): Promise<Ready> {
  const [runs, portfolio, deliveries] = await Promise.all([
    settle(sources.runs),
    settle(sources.portfolio),
    settle(sources.deliveries),
  ]);
  const ranked = rankAttention({ runs: runs ?? [], portfolio, deliveries: deliveries ?? [], now });
  return {
    status: 'ready',
    ...ranked,
    partial: [runs, portfolio, deliveries].includes(null),
  };
}

/**
 * "Needs you now": the ranked list under the cockpit.
 *
 * It is a section of the cockpit and not a page of its own: the cockpit says whether the
 * product is better or worse, and this says what is broken right now. It carries no
 * `StatusLine` of its own, because two headline numbers on one screen ask the reader to
 * choose which is the answer.
 */
export function AttentionSection({
  sources,
  navigate,
  now = () => new Date(),
}: {
  sources: NowSources;
  navigate: (to: string) => void;
  now?: () => Date;
}): React.ReactElement {
  const [state, setState] = React.useState<Ready | null>(null);
  const [lastVisit] = React.useState<string | null>(() => localStorage.getItem(LAST_VISIT_KEY));
  React.useEffect(() => {
    let live = true;
    void readAttention(sources, now()).then((ready) => {
      if (!live) return;
      setState(ready);
      localStorage.setItem(LAST_VISIT_KEY, now().toISOString());
    });
    return () => {
      live = false;
    };
    // Read once per visit; the sources are stable for the page's life.
  }, [sources]);

  const first = state?.items[0];
  const openFirst = React.useCallback(() => {
    if (first !== undefined) navigate(first.action.to);
  }, [first, navigate]);
  useCommandActions(
    first === undefined
      ? []
      : [{ id: 'now-open-first', label: `Open: ${first.title}`, onSelect: openFirst }],
  );

  if (state === null) {
    return (
      <section aria-label="Needs you now" data-testid="now-loading">
        <Skeleton className="h-24 w-full" />
      </section>
    );
  }
  return (
    <section aria-labelledby="now-heading" data-testid="now-page" className="flex flex-col gap-3">
      <h2 id="now-heading" className="text-sm font-medium text-fg">
        {sentenceOf(state.total)}
      </h2>
      <AttentionList items={state.items} lastVisit={lastVisit} navigate={navigate} />
      {state.total > state.items.length ? (
        <p className="text-sm text-fg-muted">
          +{String(state.total - state.items.length)} more. Fix these first.
        </p>
      ) : null}
      {state.partial ? (
        <p role="status" className="text-sm text-fg-muted">
          Part of this could not be read, so the list may be incomplete.
        </p>
      ) : null}
    </section>
  );
}
function AttentionList({
  items,
  lastVisit,
  navigate,
}: {
  items: AttentionItem[];
  lastVisit: string | null;
  navigate: (to: string) => void;
}): React.ReactElement {
  if (items.length === 0) {
    return (
      <EmptyState
        headingLevel={2}
        data-testid="now-clear"
        title="All clear"
        description="No failing run, no falling grade, no lost report. Go do something else."
      />
    );
  }
  return (
    <ol className="flex flex-col gap-2" aria-label="Needs attention">
      {items.map((item) => (
        <li
          key={item.id}
          data-testid={`now-item-${item.id}`}
          className="flex animate-fade-in items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <span aria-hidden="true">{item.severity === 'bad' ? '🔴' : '🟡'}</span>
              <span className="truncate">{item.title}</span>
              {isNew(item, lastVisit) ? <Badge variant="outline">new</Badge> : null}
            </p>
            <p className="truncate text-sm text-fg-muted">
              {item.detail} · {ago(item.at)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => navigate(item.action.to)}
          >
            {item.action.label}
          </Button>
        </li>
      ))}
    </ol>
  );
}
