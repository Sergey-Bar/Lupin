import React from 'react';
import { defaultApiClient, type ApiClient, type Run } from '../lib/api.js';

/** How many runs the sidebar lists. Past this a list stops being "recent" and becomes the page. */
export const RECENT_RUN_LIMIT = 6;

/**
 * The few most recent runs, read once when the shell mounts.
 *
 * Deliberately **not** `useRuns`: that hook arms a poller and subscribes to the run stream, and
 * the runs page relies on there being exactly one of each (`routes/dashboard.test.tsx`). The
 * sidebar is a way back to a run, not a live view of it, so one read is enough, and a failed
 * read shows no list rather than an error in the chrome.
 */
export function useRecentRuns(api: ApiClient = defaultApiClient): readonly Run[] {
  const [runs, setRuns] = React.useState<readonly Run[]>([]);
  React.useEffect(() => {
    const controller = new AbortController();
    api
      .getRuns({ signal: controller.signal, limit: RECENT_RUN_LIMIT })
      .then((all) => {
        if (!controller.signal.aborted) setRuns(all.slice(0, RECENT_RUN_LIMIT));
      })
      .catch(() => {
        // The chrome never shows an error of its own; the runs page is where a failure is read.
      });
    return () => controller.abort();
  }, [api]);
  return runs;
}
