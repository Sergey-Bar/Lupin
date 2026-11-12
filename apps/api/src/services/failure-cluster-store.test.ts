import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { Hono } from 'hono';
import { QaInsightsSchema } from '@lupin/shared-contracts';
import { createInsightsRoutes } from '../execution/insights.js';
import type { ExecutionRun, ExecutionStore, ExecutionTestResult } from '../execution/types.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  readStoredClusters,
  refreshAllClusters,
  refreshWorkspaceClusters,
} from './failure-cluster-store.js';
import { setTriageLabel } from './triage-label-service.js';

/** Failure causes as a stored job (plan tasks 11 and 12), on the real migration graph. */
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

const failing = (title: string, message: string): ExecutionTestResult => ({
  id: title,
  title,
  file: 'a.spec.ts',
  status: 'failed',
  durationMs: 10,
  error: { message },
});

let sequence = 0;
function run(createdAt: string, projectId: string | null, tests: ExecutionTestResult[]) {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    createdAt,
    completedAt: createdAt,
    outcome: 'failed',
    suite: 'e2e',
    branch: 'main',
    projectId,
    tests,
    summary: {
      total: tests.length,
      passed: 0,
      failed: tests.length,
      flaky: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: null,
    },
  } as unknown as ExecutionRun;
}

/** Answers `listRuns` per workspace, newest first, as the execution store does. */
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

const REFUSED = 'Error: connect ECONNREFUSED 127.0.0.1:5432';

describe('the failure-cluster job', () => {
  it('stores each scope with first seen, last seen and occurrences, and replaces it next time', async () => {
    const db = await setup();
    const runs = [
      run('2026-11-01T08:00:00.000Z', 'p1', [failing('a', REFUSED), failing('b', REFUSED)]),
      run('2026-11-10T08:00:00.000Z', 'p2', [failing('a', REFUSED), failing('c', 'Error: boom')]),
    ];
    await refreshWorkspaceClusters(db as never, storeOf({ 'ws-1': runs }), 'ws-1', NOW);
    const all = await readStoredClusters(db as never, 'ws-1', '', 20);
    expect(all?.totals).toEqual({ failures: 4, causes: 2 });
    expect(all?.clusters[0]).toMatchObject({
      count: 3,
      runs: 2,
      firstSeen: '2026-11-01T08:00:00.000Z',
      lastSeen: '2026-11-10T08:00:00.000Z',
      tests: ['a.spec.ts › a', 'a.spec.ts › b'],
      sampleMessage: REFUSED,
    });
    expect((await readStoredClusters(db as never, 'ws-1', 'p2', 20))?.totals).toEqual({
      failures: 2,
      causes: 2,
    });
    // A cause that stopped appearing is gone after the next pass.
    await refreshWorkspaceClusters(db as never, storeOf({ 'ws-1': runs.slice(0, 1) }), 'ws-1', NOW);
    expect((await readStoredClusters(db as never, 'ws-1', '', 20))?.totals).toEqual({
      failures: 2,
      causes: 1,
    });
  });

  it("never shows one workspace another's causes, and reports none before its first pass", async () => {
    const db = await setup();
    expect(await readStoredClusters(db as never, 'ws-1', '', 20)).toBeNull();
    const errors: string[] = [];
    await refreshAllClusters(
      db as never,
      storeOf({ 'ws-2': [run('2026-11-10T08:00:00.000Z', null, [failing('x', REFUSED)])] }),
      (id) => errors.push(id),
      NOW,
    );
    expect(errors).toEqual([]);
    expect(await readStoredClusters(db as never, 'ws-1', '', 20)).toBeNull();
    expect((await readStoredClusters(db as never, 'ws-2', '', 20))?.totals.causes).toBe(1);
  });

  it('serves the stored causes on the Tests page, a known one labelled and still counted', async () => {
    const db: MigratedDb = await setup();
    const runs = [run('2026-11-10T08:00:00.000Z', 'p1', [failing('a', REFUSED)])];
    await refreshWorkspaceClusters(db as never, storeOf({ 'ws-1': runs }), 'ws-1', NOW);
    const stored = await readStoredClusters(db as never, 'ws-1', '', 20);
    const signature = stored?.clusters[0]?.signature ?? '';
    await setTriageLabel(
      { db: db as never, workspaceId: 'ws-1' },
      { signature, category: 'known-issue', reason: 'the database restarts nightly' },
      'token:operator',
    );
    const app = new Hono().route(
      '/',
      createInsightsRoutes({
        // The window's own runs say nothing; the page reads what the job stored.
        store: storeOf({}),
        workspaceId: 'ws-1',
        now: () => NOW,
        labels: async () => {
          const { listTriageLabels } = await import('./triage-label-service.js');
          return listTriageLabels({ db: db as never, workspaceId: 'ws-1' });
        },
        storedClusters: {
          days: 90,
          read: (key) => readStoredClusters(db as never, 'ws-1', key, 20),
        },
      }),
    );
    const insights = QaInsightsSchema.parse(
      await (await app.request('/api/v1/dashboard/insights?days=7')).json(),
    );
    expect(insights.failureClusters?.summary).toBe('1 failure, 1 cause in 90 days');
    expect(insights.failureClusters?.clusters[0]?.label).toEqual({
      category: 'known-issue',
      issueUrl: null,
      reason: 'the database restarts nightly',
    });
    // Known is a label, never a pass: the failure is still counted.
    expect(insights.failureClusters?.totals.failures).toBe(1);
  });
});
