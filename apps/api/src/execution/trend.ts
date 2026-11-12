import { Hono } from 'hono';
import type { AnalyticsTrend, TrendBucket, TrendWindow } from '@lupin/shared-contracts';
import { encodeRunCursor } from './run-paging.js';
import type { ExecutionRun, ExecutionStore } from './types.js';

const DAY_MS = 86_400_000;
/** The read stops here, and says so with `truncated`, rather than walking the whole history. */
const MAX_RUNS = 1_000;
const PAGE = 100;

/**
 * Run history as a daily series, and "now" against the window before it.
 *
 * ## Read from the canonical store, not the legacy run table
 *
 * `analytics/summary` aggregates the legacy `runs` rows the reporter writes. A run the
 * runner executed lives in the execution store, and a trend that left those out would
 * report a quiet week for a team that ran a hundred suites from this product. This reads
 * the same store `GET /api/v1/runs` lists.
 *
 * ## Bounded, newest first
 *
 * Paged through the store's own cursor, newest first, stopping at the start of the
 * earlier window or at `MAX_RUNS`. The cap is reported rather than hidden: a trend
 * computed from a truncated read is still a true statement about the runs it read, and
 * the screen says which.
 */
export function createAnalyticsTrendRoutes(options: {
  store: ExecutionStore;
  workspaceId: string;
  now?: () => Date;
  /**
   * The daily rollups (plan task 13): the trend for `days` days ending on `end`, or `null`
   * before the job's first pass. Absent, the trend is computed from the runs in its window.
   */
  rollups?: (projectKey: string, end: Date, days: number) => Promise<AnalyticsTrend | null>;
}): Hono {
  const app = new Hono();
  app.get('/api/v1/dashboard/analytics/trend', async (context) => {
    const now = options.now?.() ?? new Date();
    const projectKey = context.req.query('projectId') ?? '';
    const range = customRange(context.req.query('from'), context.req.query('to'));
    if (range !== null && options.rollups !== undefined) {
      const ranged = await options.rollups(projectKey, range.end, range.days);
      if (ranged !== null) return context.json(ranged);
    }
    const requested = Number(context.req.query('days') ?? '14');
    const days = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 90) : 14;
    const rolled = await options.rollups?.(projectKey, now, days);
    if (rolled !== undefined && rolled !== null) return context.json(rolled);
    const since = startOfDay(now).getTime() - (2 * days - 1) * DAY_MS;
    const { runs, truncated } = await readSince(options.store, options.workspaceId, since);
    const scoped = projectKey === '' ? runs : runs.filter((run) => belongsTo(run, projectKey));
    return context.json(buildTrend(scoped, now, days, truncated));
  });
  return app;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
/** The longest custom range served, from the rollups only. */
const MAX_RANGE_DAYS = 366;

/** `from`..`to`, both `YYYY-MM-DD` and inclusive, as an end day and a length; else `null`. */
export function customRange(
  from: string | undefined,
  to: string | undefined,
): { end: Date; days: number } | null {
  if (from === undefined || to === undefined) return null;
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) return null;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const days = Math.round((end - start) / DAY_MS) + 1;
  return days > MAX_RANGE_DAYS ? null : { end: new Date(end), days };
}

/** A run counts toward a project when it names it or names none, as the insights page reads. */
function belongsTo(run: ExecutionRun, projectId: string): boolean {
  return run.projectId === projectId || run.projectId === null;
}

export async function readSince(
  store: ExecutionStore,
  workspaceId: string,
  since: number,
): Promise<{ runs: ExecutionRun[]; truncated: boolean }> {
  const runs: ExecutionRun[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await store.listRuns(workspaceId, undefined, { limit: PAGE, after });
    for (const run of page.runs) {
      if (Date.parse(run.createdAt) < since) return { runs, truncated: false };
      runs.push(run);
      if (runs.length >= MAX_RUNS) return { runs, truncated: page.hasMore };
    }
    const last = page.runs.at(-1);
    if (!page.hasMore || last === undefined) return { runs, truncated: false };
    after = encodeRunCursor(last);
  }
}

export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function durationOf(run: ExecutionRun): number | null {
  if (run.summary.durationMs !== null) return run.summary.durationMs;
  if (run.startedAt === null || run.completedAt === null) return null;
  const elapsed = Date.parse(run.completedAt) - Date.parse(run.startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

function average(values: number[]): number | null {
  return values.length === 0
    ? null
    : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** A share of runs with a verdict, so a cancelled run neither passes nor fails. */
export function passRate(passed: number, failed: number): number | null {
  const verdicts = passed + failed;
  return verdicts === 0 ? null : Math.round((passed / verdicts) * 1000) / 10;
}

export function buildTrend(
  runs: readonly ExecutionRun[],
  now: Date,
  days: number,
  truncated: boolean,
): AnalyticsTrend {
  const today = startOfDay(now).getTime();
  const currentFrom = today - (days - 1) * DAY_MS;
  const previousFrom = currentFrom - days * DAY_MS;
  const buckets = Array.from({ length: days }, (_, index) =>
    bucket(
      dayKey(currentFrom + index * DAY_MS),
      runs.filter(
        (run) => dayKey(Date.parse(run.createdAt)) === dayKey(currentFrom + index * DAY_MS),
      ),
    ),
  );
  const inRange = (from: number, to: number) =>
    runs.filter((run) => {
      const created = Date.parse(run.createdAt);
      return created >= from && created < to;
    });
  return {
    days,
    buckets,
    current: summarise(inRange(currentFrom, today + DAY_MS), currentFrom, today + DAY_MS),
    previous: summarise(inRange(previousFrom, currentFrom), previousFrom, currentFrom),
    truncated,
  };
}

export function trendBucket(date: string, runs: readonly ExecutionRun[]): TrendBucket {
  return bucket(date, runs);
}

/** A run's duration in milliseconds, or `null` when it has none. */
export function runDuration(run: ExecutionRun): number | null {
  return durationOf(run);
}

function bucket(date: string, runs: readonly ExecutionRun[]): TrendBucket {
  const passed = runs.filter((run) => run.outcome === 'passed').length;
  const failed = runs.filter((run) => run.outcome === 'failed').length;
  // A run without a verdict *because* a test flipped: the product maps a flaky run to
  // `partial`, so this is carved out of what used to be `other` and the four still sum.
  const flaky = runs.filter((run) => run.outcome === 'partial' && run.summary.flaky > 0).length;
  return {
    date,
    runs: runs.length,
    passed,
    failed,
    flaky,
    other: runs.length - passed - failed - flaky,
    passRate: passRate(passed, failed),
    avgDurationMs: average(runs.map(durationOf).filter((value): value is number => value !== null)),
    tests: runs.reduce((sum, run) => sum + run.summary.total, 0),
    testsFailed: runs.reduce((sum, run) => sum + run.summary.failed, 0),
  };
}

function summarise(runs: readonly ExecutionRun[], from: number, to: number): TrendWindow {
  const totals = bucket(dayKey(from), runs);
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    runs: totals.runs,
    passRate: totals.passRate,
    failedRuns: totals.failed,
    avgDurationMs: totals.avgDurationMs,
    tests: totals.tests,
    testsFailed: totals.testsFailed,
    flakyTests: runs.reduce((sum, run) => sum + run.summary.flaky, 0),
  };
}
