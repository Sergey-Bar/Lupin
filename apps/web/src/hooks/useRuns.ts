import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { defaultApiClient, isAbortError, type Run, type RunEvent } from '../lib/api.js';
import { useRequestLifecycle } from './use-request-lifecycle.js';

/**
 * The newest run list anyone in this tab has read, so the sidebar's count reuses the list the
 * Runs page already holds instead of fetching it a second time. `null` until a list lands.
 */
let latestRuns: readonly Run[] | null = null;
const latestListeners = new Set<() => void>();

export function publishRuns(runs: readonly Run[]): void {
  latestRuns = runs;
  for (const listener of latestListeners) listener();
}

/** For tests: forget the shared list between cases. */
export function resetLatestRuns(): void {
  latestRuns = null;
}

export function useLatestRuns(): readonly Run[] | null {
  return useSyncExternalStore(
    (listener) => {
      latestListeners.add(listener);
      return () => latestListeners.delete(listener);
    },
    () => latestRuns,
  );
}

const POLL_MS = 5000;
const POLL_MAX_MS = 60_000;

const ACTIVE_PHASES = new Set<Run['phase']>([
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
]);

export function projectRunEvent(run: Run, event: RunEvent): Run {
  switch (event.type) {
    case 'run.queued':
      return { ...run, phase: event.payload.phase, outcome: event.payload.outcome };
    case 'run.assigned':
      return { ...run, phase: event.payload.phase, outcome: event.payload.outcome };
    case 'run.started':
      return { ...run, phase: event.payload.phase, outcome: event.payload.outcome };
    case 'run.phase_changed':
      return { ...run, phase: event.payload.phase, outcome: event.payload.outcome };
    case 'run.completed':
      return {
        ...run,
        phase: event.payload.phase,
        outcome: event.payload.outcome,
        finishedAt: event.payload.finishedAt,
      };
    default:
      return run;
  }
}

/**
 * Take ownership of the next request, cancelling whatever is still in flight.
 *
 * The 5-second poll, an SSE-driven refetch and the initial load can all be
 * in flight at once, and the last one started is the only one whose answer is
 * still wanted — the earlier ones hold their sockets open and then write over the
 * newer result. One controller at a time makes "superseded" a fact rather than a
 * race.
 */
export function useRuns(api = defaultApiClient) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLive, setIsLive] = useState(false);
  /** Mirrors `isLive` for the poll interval, whose closure is created once. */
  const isLiveRef = useRef(false);
  const runsRef = useRef<Run[]>([]);
  /** Failed loads in a row, which the stream-down poll backs off by. */
  const failuresRef = useRef(0);
  const mountedRef = useRef(true);
  const { begin: beginLoad, cancelAll: cancelLoads } = useRequestLifecycle();
  /** The load in flight, if any — what an event-driven refresh waits behind. */
  const inFlightRef = useRef<Promise<void> | null>(null);
  /** An event asked for fresh data while a load was in flight. */
  const refreshQueuedRef = useRef(false);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (!mountedRef.current) return;
      if (showLoading) setIsLoading(true);
      const signal = beginLoad();
      const load = (async () => {
        try {
          const data = await api.getRuns({ signal });
          if (!mountedRef.current) return;
          runsRef.current = data;
          failuresRef.current = 0;
          setRuns(data);
          publishRuns(data);
          setError(null);
          setIsLoading(false);
        } catch (caught) {
          // A cancellation is something this hook asked for, so it is not a
          // failure and must not replace a rendered list with an error. Nor does
          // it end the loading state: the request that superseded it will.
          if (isAbortError(caught)) return;
          failuresRef.current += 1;
          if (mountedRef.current) {
            setError(caught instanceof Error ? caught : new Error('Failed to fetch runs'));
            setIsLoading(false);
          }
        }
      })();
      inFlightRef.current = load;
      await load;
      if (inFlightRef.current !== load) return;
      inFlightRef.current = null;
      if (refreshQueuedRef.current && mountedRef.current) {
        refreshQueuedRef.current = false;
        void refresh();
      }
    },
    [api, beginLoad],
  );

  /**
   * A refresh an *event* asked for. Coalesced rather than superseding: a stream
   * emitting test events faster than one round trip used to abort every request it
   * started, so no list ever landed while a run was busy. One follow-up load after
   * the one in flight answers every event that arrived meanwhile.
   */
  const requestRefresh = useCallback(() => {
    if (inFlightRef.current !== null) {
      refreshQueuedRef.current = true;
      return;
    }
    void refresh();
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh(true);

    const unsubscribe = api.subscribeToRunEvents({
      onEvent: (event) => {
        const knownRun = runsRef.current.find((run) => run.id === event.runId);
        setRuns((current) => {
          const index = current.findIndex((run) => run.id === event.runId);
          if (index < 0) return current;
          const updated = [...current];
          updated[index] = projectRunEvent(updated[index] as Run, event);
          runsRef.current = updated;
          publishRuns(updated);
          return updated;
        });
        const needsRefresh =
          !knownRun ||
          event.type.startsWith('test.') ||
          event.type === 'artifact.created' ||
          event.type === 'gate.evaluated';
        if (needsRefresh) requestRefresh();
      },
      onReconnect: () => void refresh(),
      onConnectionChange: (live) => {
        isLiveRef.current = live;
        setIsLive(live);
      },
    });

    // The poller is a safety net, not a second source of truth.
    //
    // It used to refresh the whole list every five seconds regardless of whether
    // the stream was connected — so on a healthy connection every page paid for a
    // full list fetch to discover what the stream had already pushed, and the
    // fetch was also a chance for a run added by *another* session to arrive
    // before it had an event (ledger W-5).
    //
    // It now runs only while the stream is down, which is the only case where
    // polling is the only way to learn anything. Connected, the stream is
    // authoritative and this does nothing; disconnected, it is what keeps the
    // page honest.
    //
    // A ref rather than the state value, because the timer closure is created
    // once and would otherwise capture the first render's `false` forever.
    //
    // **It backs off and pauses** (ledger MNT-188). A chain of timeouts rather than an
    // interval, so each wait can depend on the last answer: five seconds, doubled for each
    // failure in a row up to a minute. A hidden tab is not polled at all, and is read once
    // when it is shown again.
    let timer: number | undefined;
    const schedule = () => {
      const wait = Math.min(POLL_MS * 2 ** Math.max(failuresRef.current - 1, 0), POLL_MAX_MS);
      timer = window.setTimeout(() => void tick(), wait);
    };
    const tick = async () => {
      if (!isLiveRef.current && document.visibilityState !== 'hidden') await refresh();
      if (mountedRef.current) schedule();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || isLiveRef.current) return;
      window.clearTimeout(timer);
      void tick();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mountedRef.current = false;
      cancelLoads();
      unsubscribe();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [api, refresh, requestRefresh, cancelLoads]);

  return { runs, isLoading, error, isLive, refresh };
}

export function isRunActive(run: Run): boolean {
  return ACTIVE_PHASES.has(run.phase);
}
