import React from 'react';
import { Badge, Button, StatusDot, cn } from '@lupin/ui';
import { PageBody, PageFrame, PageHeader } from './kit.js';
import { useCommandActions } from '../hooks/useCommandActions.js';

/**
 * One area of the pyramid (Tests, Health, Delivery), drawn the same way every time so a reader
 * learns the shape once: a one-sentence verdict, at most three things to act on, the rest
 * folded, and the raw numbers under "Details" for the reader who wants them.
 *
 * The rules are the ADHD-friendly ones, and `AreaPage.test.tsx` holds each: one primary button
 * on the screen, at most three items above the fold, a word beside every dot, and a marker on
 * what is new since the last visit. Motion is the calm arrival only, staggered by token.
 */
export type AreaTone = 'bad' | 'warn' | 'good' | 'info';

export type AreaAction =
  | { label: string; to: string }
  /** Lupin does it for you: the label is the verb, and the button shows progress. */
  | { label: string; run: () => Promise<void>; busyLabel?: string };

export interface AreaItem {
  id: string;
  title: string;
  detail: string;
  tone: AreaTone;
  /** When it happened, for the "new since your last visit" marker. */
  at?: string;
  action: AreaAction;
}

export const ABOVE_THE_FOLD = 3;

const TONE_WORD: Record<AreaTone, string> = {
  bad: 'Needs you',
  warn: 'Worth a look',
  good: 'Fine',
  info: 'For context',
};

const STAGGER = [
  '',
  '[animation-delay:var(--lupin-duration-75)]',
  '[animation-delay:var(--lupin-duration-150)]',
];

function busyWord(action: { label: string; busyLabel?: string }): string {
  if (action.busyLabel !== undefined) return action.busyLabel;
  const verb = action.label.split(' ')[0] ?? action.label;
  return verb.endsWith('e') ? `${verb.slice(0, -1)}ing` : `${verb}ing`;
}

export function AreaPage({
  title,
  verdict,
  items,
  navigate,
  details,
  clear = 'Nothing here needs you.',
  actions,
  subtitle,
  hero,
}: {
  title: string;
  verdict: string;
  items: readonly AreaItem[];
  navigate: (to: string) => void;
  /** The dense, senior view: every number and panel, folded until asked for. */
  details?: React.ReactNode;
  clear?: string;
  /** The page's switchers (project, window), drawn in the header. */
  actions?: React.ReactNode;
  /** Which subject this is about (the project), so the reader knows where they are. */
  subtitle?: React.ReactNode;
  /** The page's one verdict, full width above everything (kit v2 `Hero`). */
  hero?: React.ReactNode;
}): React.ReactElement {
  const key = `lupin-area-${title.toLowerCase()}`;
  const [lastVisit] = React.useState<string | null>(() => localStorage.getItem(key));
  React.useEffect(() => {
    localStorage.setItem(key, new Date().toISOString());
  }, [key]);
  const [doneIds, setDone] = React.useState<readonly string[]>([]);
  const live = items.filter((entry) => !doneIds.includes(entry.id));
  const top = live.slice(0, ABOVE_THE_FOLD);
  const rest = live.slice(ABOVE_THE_FOLD);
  // "For context" and "Fine" items are information, not work, so they are not counted.
  const needing = live.filter((entry) => entry.tone === 'bad' || entry.tone === 'warn').length;
  const [notice, setNotice] = React.useState<string | null>(null);
  const finish = (entry: AreaItem) => setDone((ids) => [...ids, entry.id]);
  const announce = (entry: AreaItem) => setNotice(`Done: ${entry.title}`);
  // Every action Lupin can take here is in the command palette too, so "quarantine login"
  // or "retry" does it from anywhere on the page. It runs exactly as the button does.
  const paletteActions = React.useMemo(
    () =>
      live.flatMap((entry) => {
        const { action } = entry;
        return 'run' in action
          ? [
              {
                id: `area-act-${entry.id}`,
                label: `${action.label}: ${entry.title}`,
                keywords: [title],
                onSelect: () => {
                  void action.run().then(() => {
                    finish(entry);
                    announce(entry);
                  });
                },
              },
            ]
          : [];
      }),
    // `live` is derived from `items` and the finished ids each render.
    [items, doneIds, title],
  );
  useCommandActions(paletteActions);
  return (
    <PageFrame data-testid={`area-${title.toLowerCase()}`}>
      <PageHeader
        title={title}
        {...(actions === undefined ? {} : { actions })}
        {...(subtitle === undefined ? {} : { subtitle })}
      />
      <PageBody>
        {hero}
        {/* With a hero the verdict is already said, at display size; once is enough. */}
        {hero !== undefined ? null : (
          <p data-testid="area-verdict" className="text-lg text-fg-muted">
            {/* A verdict that repeats the first item's title says it twice; a count says more. */}
            {top[0] !== undefined && verdict === top[0].title
              ? needing === 1
                ? 'One thing needs you.'
                : `${String(needing)} things need you.`
              : verdict}
          </p>
        )}
        {notice === null ? null : (
          <p role="status" className="text-sm text-success">
            {notice}
          </p>
        )}
        {top.length === 0 ? (
          <p data-testid="area-clear" className="rounded-lg bg-surface p-6 text-sm text-fg-muted">
            {clear}
          </p>
        ) : (
          <ol aria-label={`${title}: what to do`} className="flex flex-col gap-2">
            {top.map((entry, index) => (
              <Row
                key={entry.id}
                entry={entry}
                primary={index === 0}
                fresh={lastVisit !== null && entry.at !== undefined && entry.at > lastVisit}
                className={STAGGER[index] ?? ''}
                navigate={navigate}
                onDone={() => finish(entry)}
                onSucceeded={() => announce(entry)}
              />
            ))}
          </ol>
        )}
        {rest.length === 0 ? null : (
          <details
            data-testid="area-rest"
            data-chrome="secondary"
            className="text-sm text-fg-muted"
          >
            <summary className="cursor-pointer select-none rounded-md py-1 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
              {String(rest.length)} more when you are ready
            </summary>
            <ol className="mt-2 flex flex-col gap-2">
              {rest.map((entry) => (
                <Row
                  key={entry.id}
                  entry={entry}
                  primary={false}
                  fresh={lastVisit !== null && entry.at !== undefined && entry.at > lastVisit}
                  className=""
                  navigate={navigate}
                  folded
                  onDone={() => finish(entry)}
                  onSucceeded={() => announce(entry)}
                />
              ))}
            </ol>
          </details>
        )}
        {details === undefined ? null : (
          <details data-testid="area-details" data-chrome="secondary" className="group">
            <summary className="cursor-pointer select-none rounded-md py-2 text-sm text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
              Details
            </summary>
            <div className="mt-4 flex flex-col gap-4">{details}</div>
          </details>
        )}
      </PageBody>
    </PageFrame>
  );
}

function Row({
  entry,
  primary,
  fresh,
  className,
  navigate,
  onDone,
  onSucceeded,
  folded = false,
}: {
  entry: AreaItem;
  primary: boolean;
  fresh: boolean;
  className: string;
  navigate: (to: string) => void;
  onDone: () => void;
  onSucceeded: () => void;
  folded?: boolean;
}): React.ReactElement {
  const [state, setState] = React.useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  const [leaving, setLeaving] = React.useState(false);
  // A fallback for a browser that never fires `animationend`: the exit is 75ms by token, so
  // 200ms is always past it.
  React.useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(onDone, 200);
    return () => window.clearTimeout(timer);
  }, [leaving, onDone]);
  const { action } = entry;
  const act = async () => {
    if ('to' in action) {
      navigate(action.to);
      return;
    }
    setState({ busy: true, error: null });
    try {
      await action.run();
      onSucceeded();
      // Leave with the exit motion; with motion reduced there is no animation to wait for.
      if (prefersReducedMotion()) onDone();
      else setLeaving(true);
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <li
      data-testid={`area-${folded ? 'folded' : 'item'}-${entry.id}`}
      data-leaving={leaving ? 'true' : undefined}
      onAnimationEnd={leaving ? onDone : undefined}
      className={cn(
        leaving ? 'animate-fade-out' : 'animate-fade-in',
        'flex flex-col gap-3 rounded-lg bg-surface p-4 sm:flex-row sm:items-center sm:justify-between',
        primary && 'p-6',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2">
          <StatusDot status={entry.tone === 'warn' ? 'warn' : entry.tone} />
          <span className="text-xs font-medium text-fg-muted">{TONE_WORD[entry.tone]}</span>
          {fresh ? <Badge variant="outline">new</Badge> : null}
        </p>
        <p className={cn('mt-1 line-clamp-2 font-medium text-fg', primary ? 'text-xl' : 'text-sm')}>
          {entry.title}
        </p>
        <p className="truncate text-sm text-fg-muted">{entry.detail}</p>
        {state.error === null ? null : (
          <p role="alert" className="mt-1 text-sm text-danger">
            {state.error}
          </p>
        )}
      </div>
      <Button
        data-primary={primary ? 'true' : 'false'}
        {...(primary ? { 'aria-keyshortcuts': 'a' } : {})}
        variant={primary ? 'primary' : 'outline'}
        size={primary ? 'md' : 'sm'}
        className="shrink-0"
        disabled={state.busy}
        onClick={() => void act()}
      >
        {state.busy && !('to' in action) ? busyWord(action) : action.label}
        {primary ? (
          <kbd
            aria-hidden="true"
            className="ms-2 hidden rounded border border-current px-1 font-mono text-xs opacity-60 sm:inline"
          >
            A
          </kbd>
        ) : null}
      </Button>
    </li>
  );
}

/** The reader's motion choice: the OS setting, or Lupin's own Motion setting (`data-motion`). */
function prefersReducedMotion(): boolean {
  if (document.documentElement.dataset['motion'] === 'reduced') return true;
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
