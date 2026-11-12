import { useEffect, useState } from 'react';
import { defaultApiClient, type Run } from '../lib/api.js';
import { branchHistory } from '../lib/last-green.js';
import { Bdi } from './Bidi.js';

/** Module-level so the effect below sees one stable function, not one per render. */
const loadAllRuns = () => defaultApiClient.getRuns();

function short(run: Run): string {
  return run.commit?.slice(0, 7) ?? run.id.slice(0, 8);
}

/**
 * "Last green" and "first failed in" for a red run: the two runs to compare against when
 * finding what broke it. Says nothing until the history has loaded, and nothing at all when
 * the branch has no earlier green, rather than pointing at a run that proves nothing.
 */
export function BranchHistory({
  run,
  loadRuns = loadAllRuns,
}: {
  run: Run;
  loadRuns?: () => Promise<Run[]>;
}) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    let live = true;
    loadRuns().then(
      (loaded) => live && setRuns(loaded),
      () => live && setRuns([]),
    );
    return () => {
      live = false;
    };
  }, [run.id, loadRuns]);
  if (runs === null) return null;
  const { lastGreen, firstRed } = branchHistory(run, runs);
  if (lastGreen === null) return null;
  return (
    <p
      data-testid="branch-history"
      className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted"
    >
      <span>
        Last green on <Bdi>{run.branch}</Bdi>:{' '}
        <a
          href={`/dashboard/runs/${encodeURIComponent(lastGreen.id)}`}
          className="rounded-sm font-mono text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {short(lastGreen)}
        </a>
      </span>
      {firstRed === null || firstRed.id === run.id ? null : (
        <span>
          First failed in{' '}
          <a
            href={`/dashboard/runs/${encodeURIComponent(firstRed.id)}`}
            className="rounded-sm font-mono text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {short(firstRed)}
          </a>
        </span>
      )}
    </p>
  );
}
