import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import * as schema from '@lupin/db';
import { AnalyticsTrendSchema } from '@lupin/shared-contracts';
import { buildTrend, createAnalyticsTrendRoutes, customRange } from '../execution/trend.js';
import type { ExecutionRun, ExecutionStore } from '../execution/types.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import {
  readRollupTrend,
  refreshAllRollups,
  refreshWorkspaceRollups,
} from './trend-rollup-store.js';

/** Daily trend rollups (plan task 13), on the real migration graph. */
const NOW = new Date('2026-11-12T12:00:00.000Z');
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  await db
    .insert(schema.workspaces)
    .values({ id: 'ws-2', name: 'ws-2', configPath: '.', createdAt: NOW })
    .onConflictDoNothing();
  return db;
}

let sequence = 0;
function run(
  createdAt: string,
  outcome: ExecutionRun['outcome'],
  projectId: string | null,
  durationMs: number | null,
  flaky = 0,
): ExecutionRun {
  sequence += 1;
  return {
    id: `run-${String(sequence)}`,
    createdAt,
    startedAt: null,
    completedAt: createdAt,
    outcome,
    projectId,
    tests: [],
    summary: {
      total: 4,
      passed: 3,
      failed: outcome === 'failed' ? 1 : 0,
      flaky,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs,
    },
  } as unknown as ExecutionRun;
}

function storeOf(byWorkspace: Record<string, ExecutionRun[]>): ExecutionStore {
  return {
    listRuns: async (workspaceId: string) => ({
      runs: [...(byWorkspace[workspaceId] ?? [])].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
      hasMore: false,
    }),
  } as unknown as ExecutionStore;
}

const RUNS = [
  run('2026-11-12T08:00:00.000Z', 'passed', 'p1', 1000),
  run('2026-11-12T09:00:00.000Z', 'failed', 'p2', 3000),
  run('2026-11-11T08:00:00.000Z', 'partial', 'p1', null, 2),
  run('2026-11-05T08:00:00.000Z', 'failed', 'p1', 2000),
  run('2026-11-01T08:00:00.000Z', 'passed', null, 500),
];

describe('the trend rollups', () => {
  it('read the same trend the runs give, for the window and the one before it', async () => {
    const db = await setup();
    await refreshWorkspaceRollups(db as never, storeOf({ 'ws-1': RUNS }), 'ws-1', NOW);
    const rolled = await readRollupTrend(db as never, 'ws-1', '', NOW, 7);
    expect(AnalyticsTrendSchema.parse(rolled)).toEqual(rolled);
    expect(rolled).toEqual(buildTrend(RUNS, NOW, 7, false));
  });

  it('scope a project, with the runs that name no project counted toward it', async () => {
    const db = await setup();
    await refreshWorkspaceRollups(db as never, storeOf({ 'ws-1': RUNS }), 'ws-1', NOW);
    const p1 = await readRollupTrend(db as never, 'ws-1', 'p1', NOW, 14);
    const expected = buildTrend(
      RUNS.filter((entry) => entry.projectId !== 'p2'),
      NOW,
      14,
      false,
    );
    expect(p1).toEqual(expected);
  });

  it("never read another workspace's rows, and say nothing before the first pass", async () => {
    const db = await setup();
    expect(await readRollupTrend(db as never, 'ws-1', '', NOW, 7)).toBeNull();
    const failures: string[] = [];
    await refreshAllRollups(db as never, storeOf({ 'ws-2': RUNS }), (id) => failures.push(id), NOW);
    expect(failures).toEqual([]);
    const mine = await readRollupTrend(db as never, 'ws-1', '', NOW, 7);
    expect(mine?.current.runs).toBe(0);
    expect((await readRollupTrend(db as never, 'ws-2', '', NOW, 7))?.current.runs).toBe(3);
  });

  it('serve a custom range from the rollups, and refuse a range they cannot serve', async () => {
    const db = await setup();
    await refreshWorkspaceRollups(db as never, storeOf({ 'ws-1': RUNS }), 'ws-1', NOW);
    const app = new Hono().route(
      '/',
      createAnalyticsTrendRoutes({
        store: storeOf({}),
        workspaceId: 'ws-1',
        now: () => NOW,
        rollups: (key, end, days) => readRollupTrend(db as never, 'ws-1', key, end, days),
      }),
    );
    const ranged = AnalyticsTrendSchema.parse(
      await (
        await app.request('/api/v1/dashboard/analytics/trend?from=2026-11-01&to=2026-11-05')
      ).json(),
    );
    expect(ranged.days).toBe(5);
    expect(ranged.current.runs).toBe(2);
    // The window's own runs are empty: the 90-day chart came from the rollups.
    const ninety = AnalyticsTrendSchema.parse(
      await (await app.request('/api/v1/dashboard/analytics/trend?days=90')).json(),
    );
    expect(ninety.current.runs).toBe(5);
    expect(customRange('2026-11-05', '2026-11-01')).toBeNull();
    expect(customRange('2025-01-01', '2026-11-01')).toBeNull();
    expect(customRange('2026-11-01', 'soon')).toBeNull();
    expect(customRange(undefined, '2026-11-01')).toBeNull();
  });
});
