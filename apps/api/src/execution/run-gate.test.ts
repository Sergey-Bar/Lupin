import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import { createGateEvaluation, defaultPolicy } from './quality-gate.js';
import { latestGate, runGate } from './run-gate.js';
import type { ExecutionRun, ExecutionStore } from './types.js';

/**
 * REL-2: the readiness card read `run.policyEvaluation`, and the PostgreSQL store maps every
 * run with `policyEvaluation: null`, so Home said no gate had evaluated anything. These tests
 * use a store that behaves the same way (the gate lives only behind `getRunGate`), which is the
 * condition the in-memory store hid by copying the gate onto the run.
 */
const WS = 'ws-gate';

function finished(
  store: InMemoryExecutionStore,
  run: ExecutionRun,
  outcome: 'passed' | 'failed',
  at: string,
) {
  const failed = outcome === 'failed' ? 1 : 0;
  return {
    ...run,
    phase: 'complete' as const,
    outcome,
    createdAt: at,
    completedAt: at,
    rawEvidenceRefs: ['report:junit'],
    tests: [
      {
        id: 't',
        title: 't',
        file: null,
        status: outcome,
        durationMs: 1,
        attempt: 1,
        error: null,
        metadata: {},
      },
    ],
    summary: {
      total: 1,
      passed: 1 - failed,
      failed,
      flaky: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: 1,
    },
    policyEvaluation: null,
  } satisfies ExecutionRun;
}

/** The PostgreSQL store's shape: runs never carry their gate; `getRunGate` is the only door. */
function postgresLike(store: InMemoryExecutionStore): ExecutionStore {
  return new Proxy(store, {
    get(target, key, receiver) {
      if (key === 'getRunGate') return async () => null;
      return Reflect.get(target, key, receiver);
    },
  });
}

describe('the gate a run has, read in one place', () => {
  it('judges the newest finished run when no evaluation was recorded', async () => {
    const store = new InMemoryExecutionStore();
    const created = await store.create({ projectId: 'p' }, 'k1', WS);
    const green = finished(store, created.run, 'passed', '2026-11-18T10:00:00.000Z');
    const red = finished(
      store,
      { ...created.run, id: 'run-red' },
      'failed',
      '2026-11-18T11:00:00.000Z',
    );

    expect(await latestGate(postgresLike(store), WS, [green])).toEqual({
      status: 'passed',
      runId: green.id,
    });
    expect(await latestGate(postgresLike(store), WS, [green, red])).toEqual({
      status: 'failed',
      runId: 'run-red',
    });
  });

  it('returns the recorded evaluation when there is one, and says it was recorded', async () => {
    const store = new InMemoryExecutionStore();
    const created = await store.create({ projectId: 'p' }, 'k2', WS);
    const run = finished(store, created.run, 'passed', '2026-11-18T10:00:00.000Z');
    const policy = await store.createPolicy(defaultPolicy(WS));
    await store.saveGate(createGateEvaluation({ run: { ...run, outcome: 'failed' }, policy }));
    const gate = await runGate(store, WS, run);
    expect(gate).toMatchObject({ status: 'failed', recorded: true });
  });

  it('has no gate for a window with no finished run', async () => {
    const store = new InMemoryExecutionStore();
    const created = await store.create({ projectId: 'p' }, 'k3', WS);
    expect(await latestGate(store, WS, [created.run])).toBeNull();
    expect(await latestGate(store, WS, [])).toBeNull();
  });

  it('never returns another workspace’s recorded evaluation for a run', async () => {
    const store = new InMemoryExecutionStore();
    const created = await store.create({ projectId: 'p' }, 'k4', WS);
    const run = finished(store, created.run, 'passed', '2026-11-18T10:00:00.000Z');
    const policy = await store.createPolicy(defaultPolicy(WS));
    await store.saveGate(createGateEvaluation({ run: { ...run, outcome: 'failed' }, policy }));
    // Asked from another workspace, the recorded `failed` is not read; the run is judged afresh.
    const other = await runGate(store, 'ws-other', run);
    expect(other?.recorded).toBe(false);
  });
});
