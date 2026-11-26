import { qualityPulse, type AiOutcomeComparison, type PulseReading } from '@lupin/reporting';
import { storedTestIdentity, type QualityPulse } from '@lupin/shared-contracts';
import { belongsTo } from '../execution/insights.js';
import { readSince } from '../execution/trend.js';
import type { ExecutionRun, ExecutionStore } from '../execution/types.js';
import { aiCodeWindows } from './ai-code-service.js';
import { readHistory } from './scan-history-service.js';

/**
 * Gathers the quality pulse's two windows for one project (plan 1795712849115 task 14).
 *
 * The same readers the readiness card and the AI-code scorecard use: the execution store
 * through `readSince`, the scan history for coverage, and `aiCodeWindows` for AI-written
 * change. `qualityPulse` in `@lupin/reporting` decides; this only reads.
 */
export type PulseOptions = Parameters<typeof readHistory>[0] & Parameters<typeof aiCodeWindows>[0];

const DAY_MS = 86_400_000;
const FAILED = new Set(['failed', 'timed_out']);

const percent = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

function passRate(runs: readonly ExecutionRun[]): number | null {
  const passed = runs.filter((run) => run.outcome === 'passed').length;
  const failed = runs.filter((run) => run.outcome === 'failed').length;
  return percent(passed, passed + failed);
}

function flakyRate(runs: readonly ExecutionRun[]): number | null {
  const total = runs.reduce((sum, run) => sum + run.summary.total, 0);
  return percent(
    runs.reduce((sum, run) => sum + run.summary.flaky, 0),
    total,
  );
}

/** Distinct tests that failed at least once; `null` for a window with no run. */
function failingTests(runs: readonly ExecutionRun[]): number | null {
  if (runs.length === 0) return null;
  const keys = new Set<string>();
  for (const run of runs) {
    for (const test of run.tests) {
      if (FAILED.has(test.status))
        keys.add(storedTestIdentity({ ...test, file: test.file ?? null }));
    }
  }
  return keys.size;
}

/** The newest gate verdict in the window: 1 passed, 0 failed, `null` for none or anything else. */
function gateOf(runs: readonly ExecutionRun[]): number | null {
  const newest = [...runs]
    .filter((run) => run.policyEvaluation !== null && run.policyEvaluation !== undefined)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const status = newest?.policyEvaluation?.status;
  return status === 'passed' ? 1 : status === 'failed' ? 0 : null;
}

const verdicts = (runs: readonly ExecutionRun[]): number =>
  runs.filter((run) => run.outcome === 'passed' || run.outcome === 'failed').length;

/** AI-written change (agent-authored and AI-assisted pooled), once past the sample floor. */
function aiRate(comparison: AiOutcomeComparison, key: 'changeFailure' | 'revert'): number | null {
  const a = comparison.groups['agent-authored'][key];
  const b = comparison.groups['ai-assisted'][key];
  const trials = a.trials + b.trials;
  return trials < comparison.minSample ? null : percent(a.successes + b.successes, trials);
}

function aiDiffCoverage(comparison: AiOutcomeComparison): number | null {
  const a = comparison.groups['agent-authored'].diffCoverage;
  const b = comparison.groups['ai-assisted'].diffCoverage;
  const size = a.sampleSize + b.sampleSize;
  if (size < comparison.minSample) return null;
  const sum = (a.value ?? 0) * a.sampleSize + (b.value ?? 0) * b.sampleSize;
  return Math.round((sum / size) * 10) / 10;
}

const pair = <T>(current: T, previous: T, read: (value: T) => number | null): PulseReading => ({
  current: read(current),
  previous: read(previous),
});

export async function projectPulse(
  options: PulseOptions,
  store: ExecutionStore,
  projectId: string,
  days: number,
  now: Date,
): Promise<QualityPulse> {
  const start = now.getTime() - days * DAY_MS;
  const earlier = start - days * DAY_MS;
  const { runs } = await readSince(store, options.workspaceId, earlier);
  const mine = runs.filter((run) => belongsTo(run, projectId));
  const at = (run: ExecutionRun) => Date.parse(run.createdAt);
  const current = mine.filter((run) => at(run) > start && at(run) <= now.getTime());
  const previous = mine.filter((run) => at(run) > earlier && at(run) <= start);

  const history = await readHistory(options, projectId, new Date(earlier));
  const coverageAt = (end: number): number | null =>
    history.points
      .filter((point) => point.coverage !== null && Date.parse(point.at) <= end)
      .map((point) => point.coverage as number)
      .at(-1) ?? null;
  const ai = await aiCodeWindows(options, projectId, days);

  return qualityPulse({
    projectId,
    evaluatedAt: now.toISOString(),
    windowDays: days,
    runs: { current: verdicts(current), previous: verdicts(previous) },
    gate: pair(current, previous, gateOf),
    passRate: pair(current, previous, passRate),
    failingTests: pair(current, previous, failingTests),
    flakyRate: pair(current, previous, flakyRate),
    coverage: { current: coverageAt(now.getTime()), previous: coverageAt(start) },
    aiChangeFailureRate: pair(ai.current, ai.previous, (c) => aiRate(c, 'changeFailure')),
    aiRevertRate: pair(ai.current, ai.previous, (c) => aiRate(c, 'revert')),
    aiDiffCoverage: pair(ai.current, ai.previous, aiDiffCoverage),
  });
}
