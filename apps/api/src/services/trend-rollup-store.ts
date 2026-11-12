/**
 * Daily trend rollups (plan task 13).
 *
 * The trend route used to read every run in its window, so a 90-day chart cost thirteen times
 * a 7-day one and stopped at the run cap. The job below writes one `trends` row per UTC day and
 * project (`''` for every project; branch `''` for every branch), and the route reads the rows
 * for any window, including a custom range, at the same cost.
 *
 * A day is recomputed from its runs rather than incremented, so the job is idempotent. The
 * first pass for a workspace backfills {@link ROLLUP_BACKFILL_DAYS}; later passes redo today and
 * yesterday, which is where a late result can still land.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { trends, workspaces } from '@lupin/db';
import type { AnalyticsTrend, TrendBucket, TrendWindow } from '@lupin/shared-contracts';
import { belongsTo } from '../execution/insights.js';
import {
  dayKey,
  passRate,
  readSince,
  runDuration,
  startOfDay,
  trendBucket,
} from '../execution/trend.js';
import type { ExecutionRun, ExecutionStore } from '../execution/types.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

type Db = ProjectRegistryServiceOptions['db'];
type Row = typeof trends.$inferSelect;

export const ROLLUP_BACKFILL_DAYS = 90;
const ROLLUP_REFRESH_DAYS = 2;
const DAY_MS = 86_400_000;
const ALL_BRANCHES = '';

async function hasRollups(db: Db, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trends)
    .where(eq(trends.workspaceId, workspaceId));
  return (row?.n ?? 0) > 0;
}

function rowFor(
  workspaceId: string,
  date: string,
  project: string,
  runs: readonly ExecutionRun[],
  now: Date,
) {
  const bucket = trendBucket(date, runs);
  const durations = runs.map(runDuration).filter((value): value is number => value !== null);
  return {
    workspaceId,
    date,
    project,
    branch: ALL_BRANCHES,
    total: bucket.runs,
    passed: bucket.passed,
    failed: bucket.failed,
    flaky: bucket.flaky,
    other: bucket.other,
    avgDurationMs: bucket.avgDurationMs,
    p95DurationMs: null,
    tests: bucket.tests,
    testsFailed: bucket.testsFailed,
    flakyTests: runs.reduce((sum, run) => sum + run.summary.flaky, 0),
    timedRuns: durations.length,
    updatedAt: now,
  };
}

/** Recomputes the recent days of one workspace. Returns how many rows it wrote. */
export async function refreshWorkspaceRollups(
  db: Db,
  store: ExecutionStore,
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  const days = (await hasRollups(db, workspaceId)) ? ROLLUP_REFRESH_DAYS : ROLLUP_BACKFILL_DAYS;
  const today = startOfDay(now).getTime();
  const since = today - (days - 1) * DAY_MS;
  const { runs } = await readSince(store, workspaceId, since);
  const projects = [
    '',
    ...new Set(runs.flatMap((run) => (run.projectId === null ? [] : [run.projectId]))),
  ];
  let written = 0;
  for (let index = 0; index < days; index += 1) {
    const date = dayKey(since + index * DAY_MS);
    const ofDay = runs.filter((run) => dayKey(Date.parse(run.createdAt)) === date);
    for (const project of projects) {
      const scoped = project === '' ? ofDay : ofDay.filter((run) => belongsTo(run, project));
      // A project with no run that day has no row; the reader fills the gap with zeros.
      if (project !== '' && scoped.length === 0) continue;
      const values = rowFor(workspaceId, date, project, scoped, now);
      await db
        .insert(trends)
        .values(values)
        .onConflictDoUpdate({
          target: [trends.workspaceId, trends.date, trends.project, trends.branch],
          set: values,
        });
      written += 1;
    }
  }
  return written;
}

/** The job: every workspace in turn; one that fails does not stop the rest. */
export async function refreshAllRollups(
  db: Db,
  store: ExecutionStore,
  onError: (workspaceId: string, error: unknown) => void,
  now: Date = new Date(),
): Promise<number> {
  const ids = await db.select({ id: workspaces.id }).from(workspaces);
  let written = 0;
  for (const { id } of ids) {
    try {
      written += await refreshWorkspaceRollups(db, store, id, now);
    } catch (error) {
      onError(id, error);
    }
  }
  return written;
}

function emptyBucket(date: string): TrendBucket {
  return {
    date,
    runs: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    other: 0,
    passRate: null,
    avgDurationMs: null,
    tests: 0,
    testsFailed: 0,
  };
}

function bucketOf(row: Row): TrendBucket {
  return {
    date: row.date,
    runs: row.total,
    passed: row.passed,
    failed: row.failed,
    flaky: row.flaky,
    other: row.other,
    passRate: passRate(row.passed, row.failed),
    avgDurationMs: row.avgDurationMs === null ? null : Math.round(row.avgDurationMs),
    tests: row.tests,
    testsFailed: row.testsFailed,
  };
}

function windowOf(rows: readonly Row[], from: number, to: number): TrendWindow {
  const sum = (pick: (row: Row) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const timed = sum((row) => row.timedRuns);
  const weighted = sum((row) => (row.avgDurationMs ?? 0) * row.timedRuns);
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    runs: sum((row) => row.total),
    passRate: passRate(
      sum((row) => row.passed),
      sum((row) => row.failed),
    ),
    failedRuns: sum((row) => row.failed),
    avgDurationMs: timed === 0 ? null : Math.round(weighted / timed),
    tests: sum((row) => row.tests),
    testsFailed: sum((row) => row.testsFailed),
    flakyTests: sum((row) => row.flakyTests),
  };
}

/**
 * The trend for `days` days ending on `end`'s UTC day, and the window before it, from the
 * rollups; `null` when the job has written none for this workspace yet.
 */
export async function readRollupTrend(
  db: Db,
  workspaceId: string,
  projectKey: string,
  end: Date,
  days: number,
): Promise<AnalyticsTrend | null> {
  if (!(await hasRollups(db, workspaceId))) return null;
  const last = startOfDay(end).getTime();
  const currentFrom = last - (days - 1) * DAY_MS;
  const previousFrom = currentFrom - days * DAY_MS;
  const rows = await db
    .select()
    .from(trends)
    .where(
      and(
        eq(trends.workspaceId, workspaceId),
        eq(trends.project, projectKey),
        eq(trends.branch, ALL_BRANCHES),
        gte(trends.date, dayKey(previousFrom)),
        lte(trends.date, dayKey(last)),
      ),
    );
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const current = rows.filter((row) => row.date >= dayKey(currentFrom));
  const previous = rows.filter((row) => row.date < dayKey(currentFrom));
  return {
    days,
    buckets: Array.from({ length: days }, (_, index) => {
      const date = dayKey(currentFrom + index * DAY_MS);
      const row = byDate.get(date);
      return row === undefined ? emptyBucket(date) : bucketOf(row);
    }),
    current: windowOf(current, currentFrom, last + DAY_MS),
    previous: windowOf(previous, previousFrom, currentFrom),
    truncated: false,
  };
}
