/**
 * Where a red run sits in its branch's history: the last run on the branch that passed
 * before it, and the first run after that green which failed, which is where the breakage
 * came in. Only earlier runs on the same branch count; a run with no branch has no history.
 */
export interface HistoryRun {
  id: string;
  branch: string | null;
  commit: string | null;
  outcome: string | null;
  createdAt: string;
}

export function branchHistory<T extends HistoryRun>(
  run: T,
  runs: readonly T[],
): { lastGreen: T | null; firstRed: T | null } {
  if (run.branch === null) return { lastGreen: null, firstRed: null };
  const earlier = runs
    .filter((other) => other.branch === run.branch && other.createdAt <= run.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let firstRed: T | null = null;
  for (const other of earlier) {
    if (other.outcome === 'passed') return { lastGreen: other, firstRed };
    if (other.outcome === 'failed') firstRed = other;
  }
  return { lastGreen: null, firstRed };
}
