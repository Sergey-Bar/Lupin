import React from 'react';
import {
  ActionCard,
  Badge,
  Button,
  EmptyState,
  RotateCcw,
  Row,
  Skeleton,
  StatusDot,
} from '@lupin/ui';
import type { DeliverySummary, GithubPullItem, Portfolio } from '@lupin/shared-contracts';
import type { Run } from '../lib/api.js';
import { isNew, rankAttention, retryLabel, type AttentionItem } from '../lib/attention.js';
import { ago } from '../lib/health-view.js';
import { focusOf, focusSentence } from '../lib/focus.js';
import { useCommandActions } from '../hooks/useCommandActions.js';
import { forPersona, personaTools } from '../lib/persona.js';
import { rowsFor } from '../lib/rows.js';
import { usePreferences } from '../theme/preferences.js';

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
  /** Open pull requests; absent or failing (GitHub not connected) simply adds nothing. */
  pulls?: () => Promise<GithubPullItem[]>;
  /**
   * One-click retry. `failed` runs only the tests that broke; `all` repeats the run. Absent,
   * the page offers only the manual action.
   */
  retryRun?: (runId: string, scope: 'all' | 'failed') => Promise<{ id: string }>;
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
  const pulls = sources.pulls === undefined ? null : await settle(sources.pulls);
  const ranked = rankAttention({
    runs: runs ?? [],
    portfolio,
    deliveries: deliveries ?? [],
    pulls: pulls ?? [],
    now,
  });
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
  underVerdict = false,
}: {
  sources: NowSources;
  navigate: (to: string) => void;
  now?: () => Date;
  /**
   * The release verdict sits above and already says the state. With nothing to act on, this
   * section then draws nothing: "All clear" under a Caution reads as a contradiction.
   */
  underVerdict?: boolean;
}): React.ReactElement {
  const [state, setState] = React.useState<Ready | null>(null);
  const { persona } = usePreferences().preferences;
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
      : [
          { id: 'now-open-first', label: `Open: ${first.title}`, onSelect: openFirst },
          ...(first.auto === undefined || sources.retryRun === undefined
            ? []
            : [
                {
                  id: 'now-retry-first',
                  label: `${retryLabel(first.auto.failed)}: ${first.title}`,
                  keywords: ['retry', 'rerun', 'again'],
                  onSelect: () => {
                    if (first.auto !== undefined)
                      void sources.retryRun?.(
                        first.auto.runId,
                        first.auto.failed > 0 ? 'failed' : 'all',
                      );
                  },
                },
              ]),
        ],
  );

  if (state === null) {
    return (
      <section aria-label="Needs you now" data-testid="now-loading">
        <Skeleton className="h-24 w-full" />
      </section>
    );
  }
  const focus = focusOf(forPersona(persona, state.items));
  const fresh = state.items.filter((item) => isNew(item, lastVisit)).length;
  // An empty marker, so the page still says it has loaded; nothing is drawn or announced.
  if (underVerdict && focus.first === undefined)
    return <div data-testid="now-page" className="hidden" />;
  return (
    <section
      aria-labelledby="focus-sentence"
      data-testid="now-page"
      className="flex flex-col gap-6"
    >
      <p id="focus-sentence" data-testid="focus-sentence" className="text-lg text-fg-muted">
        {focusSentence(state.total, fresh)}
      </p>
      {focus.first === undefined ? (
        <EmptyState
          headingLevel={2}
          data-testid="now-clear"
          title="All clear"
          description="No failing run, no falling grade, no lost report."
        />
      ) : (
        <>
          <FirstThing
            item={focus.first}
            isNew={isNew(focus.first, lastVisit)}
            navigate={navigate}
            {...(sources.retryRun === undefined ? {} : { retryRun: sources.retryRun })}
          />
          {/* What's next, Netflix-style: the rest in titled rows of one-action cards. */}
          <div data-testid="now-rows" data-chrome="secondary" className="flex flex-col gap-6">
            {rowsFor(persona, [...focus.next, ...focus.hidden]).map((row) => (
              <Row key={row.id} title={row.title}>
                {row.items.map((item) => (
                  <ActionCard
                    key={item.id}
                    tone={item.severity === 'bad' ? 'bad' : 'warn'}
                    title={item.title}
                    fact={`${item.detail} · ${ago(item.at)}`}
                    action={item.action.label}
                    onAct={() => navigate(item.action.to)}
                  />
                ))}
              </Row>
            ))}
            {state.total > state.items.length ? (
              <p className="text-sm text-fg-muted">
                {String(state.total - state.items.length)} more on the area pages.
              </p>
            ) : null}
          </div>
        </>
      )}
      {state.partial ? (
        <p role="status" className="text-sm text-fg-muted">
          Part of this could not be read, so the list may be incomplete.
        </p>
      ) : null}
      {persona === null ? null : (
        <nav
          aria-label="Your shortcuts"
          data-chrome="secondary"
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          {personaTools(persona).map((tool) => (
            <a
              key={tool.to + tool.label}
              href={tool.to}
              className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-fg-muted no-underline hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              {tool.label}
            </a>
          ))}
        </nav>
      )}
    </section>
  );
}

/**
 * The one thing to do now: large, with its single action as the primary button, so the page
 * makes the decision and the reader only has to act on it.
 */
function FirstThing({
  item,
  isNew: fresh,
  navigate,
  retryRun,
}: {
  item: AttentionItem;
  isNew: boolean;
  navigate: (to: string) => void;
  retryRun?: (runId: string, scope: 'all' | 'failed') => Promise<{ id: string }>;
}): React.ReactElement {
  const [auto, setAuto] = React.useState<
    | { state: 'idle' }
    | { state: 'busy' }
    | { state: 'done'; runId: string }
    | { state: 'failed'; message: string }
  >({ state: 'idle' });
  const canAuto = item.auto?.kind === 'retry-run' && retryRun !== undefined;
  const act = async () => {
    if (item.auto === undefined || retryRun === undefined) return;
    setAuto({ state: 'busy' });
    try {
      const next = await retryRun(item.auto.runId, item.auto.failed > 0 ? 'failed' : 'all');
      setAuto({ state: 'done', runId: next.id });
    } catch (error) {
      setAuto({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <article
      data-testid="focus-first"
      aria-label="Start here"
      className="flex animate-fade-in flex-col gap-4 rounded-lg bg-surface p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-fg-muted">Start here</p>
        <h2 className="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">
          <StatusDot status={item.severity === 'bad' ? 'bad' : 'warn'} />
          <span className="line-clamp-2">{item.title}</span>
          {fresh ? <Badge variant="outline">new</Badge> : null}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          {item.detail} · {ago(item.at)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
        <div className="flex flex-wrap gap-2">
          {canAuto && auto.state !== 'done' ? (
            <Button
              data-primary="true"
              aria-keyshortcuts="a"
              className="min-h-11"
              disabled={auto.state === 'busy'}
              onClick={() => void act()}
            >
              <RotateCcw size={16} aria-hidden="true" />
              {auto.state === 'busy' ? 'Retrying' : retryLabel(item.auto?.failed ?? 0)}
              <kbd
                aria-hidden="true"
                className="ms-1 hidden rounded border border-current px-1 font-mono text-xs opacity-60 sm:inline"
              >
                A
              </kbd>
            </Button>
          ) : null}
          {auto.state === 'done' ? (
            <Button className="min-h-11" onClick={() => navigate(`/dashboard/runs/${auto.runId}`)}>
              Watch it
            </Button>
          ) : null}
          <Button
            variant={canAuto ? 'outline' : 'default'}
            {...(canAuto ? {} : { 'data-primary': 'true', 'aria-keyshortcuts': 'a' })}
            className="min-h-11"
            onClick={() => navigate(item.action.to)}
          >
            {item.action.label}
          </Button>
        </div>
        {auto.state === 'done' ? (
          <p role="status" className="text-sm text-success">
            Retry queued. Lupin will put the result here.
          </p>
        ) : null}
        {auto.state === 'failed' ? (
          <p role="alert" className="max-w-xs text-sm text-danger">
            {auto.message}
          </p>
        ) : null}
      </div>
    </article>
  );
}
