import { describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { createDrizzleExecutionStore } from './drizzle-execution-store.js';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import { encodeRunCursor } from './run-paging.js';
import { createGateEvaluation, defaultPolicy } from './quality-gate.js';
import type { CreateRunInput, ExecutionStore, ExecutionStoreOptions } from './types.js';

/**
 * The read paths, on both stores (plan 1795712849115, the execution store's coverage row).
 *
 * `store-parity.test.ts` holds the write paths to one behaviour. What it did not reach, and
 * what nothing reached on the durable store, was a listing of more than one run (the batched
 * child loader behind every dashboard), a policy read by id, release readiness asked for by
 * workspace, and the short method names the routes call. A listing that dropped a run's tests,
 * or lent one run's runner to another, would have passed every suite.
 *
 * Each scenario runs against the in-memory store and against the Drizzle store on PGlite with
 * the real migration graph and two workspaces, so a read that one store scopes and the other
 * does not fails here.
 */

const input = (overrides: Partial<CreateRunInput> = {}): CreateRunInput =>
  ({
    source: 'api',
    testType: 'browser',
    framework: 'playwright',
    timeoutMs: 60_000,
    requiredCapabilities: [],
    labels: [],
    configuration: {},
    ...overrides,
  }) as CreateRunInput;

/** A release id in UUID form, as the routes pass one. */
const RELEASE = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

interface Opened {
  store: ExecutionStore;
  /** Makes `RELEASE` exist in ws-1, where the store needs a row for it. */
  seedRelease: () => Promise<void>;
  close: () => Promise<void>;
}

interface Harness {
  name: string;
  open: (options?: ExecutionStoreOptions) => Promise<Opened>;
}

const HARNESSES: Harness[] = [
  {
    name: 'in-memory',
    open: async (options = {}) => ({
      store: new InMemoryExecutionStore(options) as unknown as ExecutionStore,
      seedRelease: async () => undefined,
      close: async () => undefined,
    }),
  },
  {
    name: 'drizzle',
    open: async (options = {}) => {
      const { db, close } = await migratedDatabase();
      // `runs.release_id` is a foreign key onto `releases`, which needs a project.
      const seedRelease = async () => {
        const projectId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
        const createdAt = new Date('2026-11-01T00:00:00.000Z');
        await db
          .insert(schema.projects)
          .values({ id: projectId, workspaceId: 'ws-1', name: 'p', slug: 'p', createdAt });
        await db.insert(schema.releases).values({
          id: RELEASE,
          workspaceId: 'ws-1',
          projectId,
          name: 'release one',
          version: '1.0.0',
          createdAt,
        });
      };
      return {
        store: createDrizzleExecutionStore(db, { ...options, workspaceId: 'ws-1' }),
        seedRelease,
        close,
      };
    },
  },
];

async function registered(store: ExecutionStore, workspaceId: string) {
  return store.registerRunner(
    {
      id: `runner-${workspaceId}`,
      name: `runner-${workspaceId}`,
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: [],
      slots: 4,
    } as never,
    'b'.repeat(64),
    new Date(Date.now() + 3_600_000).toISOString(),
    workspaceId,
  );
}

/** Claims the next queued job in the workspace and completes it with the given tests. */
async function complete(
  store: ExecutionStore,
  runnerId: string,
  workspaceId: string,
  outcome: 'passed' | 'failed',
  tests: Array<{ id: string; title: string; status: 'passed' | 'failed' }>,
): Promise<string> {
  const claim = await store.claimJob(runnerId, ['playwright'], [], undefined, workspaceId);
  if (claim === null) throw new Error('nothing to claim');
  const failed = tests.filter((test) => test.status === 'failed').length;
  await store.completeJob(
    claim.jobId,
    {
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      status: outcome,
      outcome,
      tests: tests.map((test) => ({ ...test, file: 'a.spec.ts' })),
      summary: {
        total: tests.length,
        passed: tests.length - failed,
        failed,
        flaky: 0,
        skipped: 0,
        blocked: 0,
        unknown: 0,
      },
    } as never,
    workspaceId,
  );
  return claim.runId;
}

for (const harness of HARNESSES) {
  describe(`ExecutionStore reads (${harness.name})`, () => {
    it('lists several runs, each with its own tests and runner, and none from another workspace', async () => {
      const { store, close } = await harness.open();
      try {
        const runner = await registered(store, 'ws-1');
        await store.create(input({ externalId: 'a' }), 'list-a', 'ws-1');
        await store.create(input({ externalId: 'b' }), 'list-b', 'ws-1');
        await store.create(input({ externalId: 'c' }), 'list-c', 'ws-1');
        const elsewhere = await store.create(input({ externalId: 'z' }), 'list-z', 'ws-2');
        const completed = await complete(store, runner.id, 'ws-1', 'failed', [
          { id: 't-1', title: 'pays', status: 'passed' },
          { id: 't-2', title: 'refunds', status: 'failed' },
        ]);

        const listed = await store.list('ws-1');
        expect(listed).toHaveLength(3);
        expect(listed.map((run) => run.id)).not.toContain(elsewhere.run.id);
        const done = listed.find((run) => run.id === completed);
        expect(done?.tests.map((test) => test.title).sort()).toEqual(['pays', 'refunds']);
        expect(done?.runner?.id).toBe(runner.id);
        for (const run of listed.filter((entry) => entry.id !== completed)) {
          // A queued run borrows nothing from the run listed beside it.
          expect(run.tests).toEqual([]);
          expect(run.runner).toBeNull();
        }

        const page = await store.listRuns('ws-1', undefined, { limit: 2 });
        expect(page.runs).toHaveLength(2);
        expect(page.hasMore).toBe(true);
        expect((await store.list('ws-2')).map((run) => run.id)).toEqual([elsewhere.run.id]);
      } finally {
        await close();
      }
    });

    it('lists a run with its artifacts, filters by release, and pages on its own cursor only', async () => {
      const { store, seedRelease, close } = await harness.open();
      try {
        await seedRelease();
        const runner = await registered(store, 'ws-1');
        const released = await store.create(input({ releaseId: RELEASE }), 'page-r', 'ws-1');
        await store.create(input({ externalId: 'p2' }), 'page-2', 'ws-1');
        await store.create(input({ externalId: 'p3' }), 'page-3', 'ws-1');
        const completed = await complete(store, runner.id, 'ws-1', 'passed', [
          { id: 't-1', title: 'ships', status: 'passed' },
        ]);
        await store.addArtifact({
          runId: completed,
          jobId: null,
          testId: null,
          kind: 'trace',
          name: 'trace.zip',
          contentType: 'application/zip',
          storageKey: `ws-1/${completed}/trace.zip`,
          bytes: new Uint8Array([1, 2, 3]),
          expiresAt: null,
          legalHold: false,
          metadata: {},
        } as never);

        const listed = await store.list('ws-1');
        expect(listed.find((run) => run.id === completed)?.artifacts.map((a) => a.name)).toEqual([
          'trace.zip',
        ]);
        for (const run of listed.filter((entry) => entry.id !== completed))
          expect(run.artifacts).toEqual([]);

        expect((await store.list('ws-1', RELEASE)).map((run) => run.id)).toEqual([released.run.id]);

        // Walking the pages by the cursor each page ends on reads every run once.
        const seen: string[] = [];
        let after: string | undefined;
        for (let guard = 0; guard < 5; guard += 1) {
          const page = await store.listRuns('ws-1', undefined, {
            limit: 1,
            ...(after === undefined ? {} : { after }),
          });
          seen.push(...page.runs.map((run) => run.id));
          const last = page.runs.at(-1);
          if (!page.hasMore || last === undefined) break;
          after = encodeRunCursor(last);
        }
        expect(new Set(seen).size).toBe(3);
        expect(seen).toHaveLength(3);
        // A cursor this store never issued is an empty page, never the first page again.
        expect(await store.listRuns('ws-1', undefined, { after: 'not-a-cursor' })).toEqual({
          runs: [],
          hasMore: false,
        });
      } finally {
        await close();
      }
    });

    it('answers get, cancel and retry exactly as getRun, cancelRun and retryRun do', async () => {
      const { store, close } = await harness.open();
      try {
        const { run } = await store.create(input({ externalId: 'w' }), 'wrap-1', 'ws-1');
        expect((await store.get(run.id, 'ws-1'))?.id).toBe(run.id);
        expect(await store.get(run.id, 'ws-2')).toBeNull();
        expect(await store.get('00000000-0000-4000-8000-000000000000', 'ws-1')).toBeNull();

        expect(await store.cancel(run.id, 'ws-2')).toBeNull();
        const cancelled = await store.cancel(run.id, 'ws-1');
        expect(cancelled?.id).toBe(run.id);
        expect((await store.getRun(run.id, 'ws-1'))?.status).toBe(cancelled?.status);

        expect(await store.retry(run.id, 'ws-2', 'retry-elsewhere')).toBeNull();
        const retried = await store.retry(run.id, 'ws-1', 'retry-1');
        expect(retried?.run.id).not.toBe(run.id);
        expect(retried?.duplicate).toBe(false);
        expect(retried?.run.retryOfRunId).toBe(run.id);
        // The caller's id names the run it submitted, not the retry: on PostgreSQL it is unique
        // per workspace and source, so a retry that copied it could not be written at all.
        expect(retried?.run.externalId ?? null).toBeNull();
        expect((await store.get(run.id, 'ws-1'))?.externalId).toBe('w');
        // The same key again is the same retry, not a second one.
        expect((await store.retry(run.id, 'ws-1', 'retry-1'))?.run.id).toBe(retried?.run.id);
      } finally {
        await close();
      }
    });

    it('reads a policy by id in its own workspace only', async () => {
      const { store, close } = await harness.open();
      try {
        const policy = await store.createPolicy(defaultPolicy('ws-1'));
        expect((await store.getPolicy(policy.id, 'ws-1'))?.hash).toBe(policy.hash);
        expect(await store.getPolicy(policy.id, 'ws-2')).toBeNull();
        expect((await store.getPolicy(policy.id))?.id).toBe(policy.id);
        expect(await store.getPolicy('00000000-0000-4000-8000-000000000000', 'ws-1')).toBeNull();
        expect((await store.listPolicies('ws-1')).map((entry) => entry.id)).toEqual([policy.id]);
        expect(await store.listPolicies('ws-2')).toEqual([]);
      } finally {
        await close();
      }
    });

    it('reads release readiness the same whichever order the workspace is given in', async () => {
      const { store, seedRelease, close } = await harness.open();
      try {
        await seedRelease();
        const runner = await registered(store, 'ws-1');
        const { run } = await store.create(input({ releaseId: RELEASE }), 'rel-run', 'ws-1');
        await complete(store, runner.id, 'ws-1', 'failed', [
          { id: 't-1', title: 'ships', status: 'failed' },
        ]);
        const byRelease = await store.getReadiness(RELEASE, 'ws-1');
        const byWorkspace = await store.getReleaseReadiness('ws-1', RELEASE);
        const { evaluatedAt: _a, ...left } = byRelease;
        const { evaluatedAt: _b, ...right } = byWorkspace;
        expect(right).toEqual(left);
        expect(byWorkspace.releaseId).toBe(RELEASE);
        expect(byWorkspace.latestRunId).toBe(run.id);
        expect(byWorkspace.decision).not.toBe('unknown');
        // Another workspace has no run for the release, so it has no evidence either.
        const elsewhere = await store.getReleaseReadiness('ws-2', RELEASE);
        expect(elsewhere.latestRunId).toBeNull();
        expect(elsewhere.decision).toBe('unknown');
      } finally {
        await close();
      }
    });

    it('requeues a job whose runner went silent, and loses the run on the third silence', async () => {
      let clock = new Date('2026-11-27T10:00:00.000Z');
      const { store, close } = await harness.open({ now: () => clock, leaseDurationMs: 1_000 });
      try {
        const runner = await registered(store, 'ws-1');
        const { run } = await store.create(input({ externalId: 'lost' }), 'lost-1', 'ws-1');
        const phases: string[] = [];
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const claim = await store.claimJob(runner.id, ['playwright'], [], clock, 'ws-1');
          expect(claim?.runId).toBe(run.id);
          // The runner says nothing for longer than its lease.
          clock = new Date(clock.getTime() + 5_000);
          const [reaped] = await store.reapExpiredLeases(clock);
          expect(reaped?.runId).toBe(run.id);
          phases.push(reaped?.phase ?? 'none');
        }
        expect(phases).toEqual(['queued', 'queued', 'runner_lost']);
        const lost = await store.getRun(run.id, 'ws-1');
        expect(lost?.phase).toBe('runner_lost');
        expect(lost?.outcome).toBe('runner_lost');
        // The listing says why, as the run itself does.
        const [listed] = await store.list('ws-1');
        expect(listed?.error?.code).toBe('RUNNER_LOST');
        expect(lost?.error?.code).toBe('RUNNER_LOST');
        // Nothing is left to claim once the run is lost.
        expect(await store.claimJob(runner.id, ['playwright'], [], clock, 'ws-1')).toBeNull();
        expect(await store.reapExpiredLeases(clock)).toEqual([]);
      } finally {
        await close();
      }
    });

    it('keeps every test status a runner reports, as it reported it', async () => {
      const { store, close } = await harness.open();
      try {
        const runner = await registered(store, 'ws-1');
        await store.create(input({ externalId: 'statuses' }), 'statuses-1', 'ws-1');
        const statuses = ['passed', 'failed', 'flaky', 'skipped', 'blocked', 'unknown'] as const;
        const claim = await store.claimJob(runner.id, ['playwright'], [], undefined, 'ws-1');
        if (claim === null) throw new Error('nothing to claim');
        await store.completeJob(
          claim.jobId,
          {
            leaseId: claim.leaseId,
            fencingToken: claim.fencingToken,
            status: 'failed',
            outcome: 'failed',
            tests: statuses.map((status) => ({
              id: `t-${status}`,
              title: `a ${status} test`,
              file: 'a.spec.ts',
              status,
            })),
            summary: {
              total: 6,
              passed: 1,
              failed: 1,
              flaky: 1,
              skipped: 1,
              blocked: 1,
              unknown: 1,
            },
          } as never,
          'ws-1',
        );
        const read = await store.getRun(claim.runId, 'ws-1');
        const byTitle = new Map(read?.tests.map((test) => [test.title, test.status]));
        for (const status of statuses) expect(byTitle.get(`a ${status} test`)).toBe(status);
        expect(read?.summary).toMatchObject({ flaky: 1, skipped: 1, blocked: 1, unknown: 1 });
      } finally {
        await close();
      }
    });

    it('accepts one completion per job: not for a job it lacks, nor a second, different result', async () => {
      const { store, close } = await harness.open();
      try {
        const runner = await registered(store, 'ws-1');
        await store.create(input({ externalId: 'once' }), 'once-1', 'ws-1');
        const claim = await store.claimJob(runner.id, ['playwright'], [], undefined, 'ws-1');
        if (claim === null) throw new Error('nothing to claim');
        const completion = (outcome: 'passed' | 'failed') =>
          ({
            leaseId: claim.leaseId,
            fencingToken: claim.fencingToken,
            status: outcome,
            outcome,
            tests: [{ id: 't-1', title: 'works', file: 'a.spec.ts', status: outcome }],
            summary: {
              total: 1,
              passed: outcome === 'passed' ? 1 : 0,
              failed: outcome === 'failed' ? 1 : 0,
              flaky: 0,
              skipped: 0,
              blocked: 0,
              unknown: 0,
            },
          }) as never;
        const missing = '00000000-0000-4000-8000-000000000000';
        expect(await store.completeJob(missing, completion('passed'), 'ws-1')).toBeNull();
        expect(await store.completeJob(claim.jobId, completion('passed'), 'ws-2')).toBeNull();
        expect((await store.completeJob(claim.jobId, completion('passed'), 'ws-1'))?.status).toBe(
          'accepted',
        );
        // A second report that disagrees with the first is refused, not merged over it.
        expect(await store.completeJob(claim.jobId, completion('failed'), 'ws-1')).toBeNull();
        expect((await store.getRun(claim.runId, 'ws-1'))?.outcome).toBe('passed');
      } finally {
        await close();
      }
    });

    it('records a test streamed as events, its reason given as plain text', async () => {
      const { store, close } = await harness.open();
      try {
        const runner = await registered(store, 'ws-1');
        await store.create(input({ externalId: 'stream' }), 'stream-1', 'ws-1');
        const claim = await store.claimJob(runner.id, ['playwright'], [], undefined, 'ws-1');
        if (claim === null) throw new Error('nothing to claim');
        const results = await store.appendEvents(
          claim.jobId,
          claim.leaseId,
          claim.fencingToken,
          [
            {
              eventId: 'started',
              type: 'test.started',
              sequence: 1,
              payload: { testId: 'login', title: 'logs in', file: 'auth.spec.ts' },
            },
            {
              eventId: 'completed',
              type: 'test.completed',
              sequence: 2,
              payload: {
                testId: 'login',
                title: 'logs in',
                file: 'auth.spec.ts',
                describePath: ['auth', 7, 'session'],
                status: 'failed',
                durationMs: 120,
                error: 'the session cookie was never set',
              },
            },
            {
              eventId: 'odd',
              type: 'test.completed',
              sequence: 3,
              payload: {
                testId: 'odd',
                title: 'reports a status',
                file: 'a.spec.ts',
                status: 'exploded',
              },
            },
          ],
          'ws-1',
        );
        expect(results.map((result) => result.status)).toEqual([
          'accepted',
          'accepted',
          'accepted',
        ]);
        const test = (await store.getRun(claim.runId, 'ws-1'))?.tests.find(
          (entry) => entry.title === 'logs in',
        );
        expect(test?.status).toBe('failed');
        // A status no runner should send is kept as unknown, never as a pass or a failure.
        const odd = (await store.getRun(claim.runId, 'ws-1'))?.tests.find(
          (entry) => entry.title === 'reports a status',
        );
        expect(odd?.status).toBe('unknown');
      } finally {
        await close();
      }
    });

    it('gives a runner with every slot busy nothing more to do', async () => {
      const { store, close } = await harness.open();
      try {
        const runner = await store.registerRunner(
          {
            id: 'runner-one-slot',
            name: 'runner-one-slot',
            version: '1.0.0',
            os: 'linux',
            arch: 'x64',
            capabilities: ['playwright'],
            labels: [],
            slots: 1,
          } as never,
          'c'.repeat(64),
          new Date(Date.now() + 3_600_000).toISOString(),
          'ws-1',
        );
        await store.create(input({ externalId: 's1' }), 'slot-1', 'ws-1');
        await store.create(input({ externalId: 's2' }), 'slot-2', 'ws-1');
        expect(
          await store.claimJob(runner.id, ['playwright'], [], undefined, 'ws-1'),
        ).not.toBeNull();
        expect(await store.claimJob(runner.id, ['playwright'], [], undefined, 'ws-1')).toBeNull();
      } finally {
        await close();
      }
    });

    it('reads back a policy with its limits and rules, and a gate exactly as it was saved', async () => {
      const { store, close } = await harness.open();
      try {
        const rule = { id: 'no-new-failures', kind: 'threshold', severity: 'error' };
        const policy = await store.createPolicy({
          ...defaultPolicy('ws-1'),
          name: 'strict',
          maxDurationMs: 90_000,
          maxFlakyRate: 2,
          rules: [rule] as never,
        });
        const read = await store.getPolicy(policy.id, 'ws-1');
        expect(read).toMatchObject({ name: 'strict', maxDurationMs: 90_000, maxFlakyRate: 2 });
        expect(read?.rules).toEqual([rule]);

        const { run } = await store.create(input({ externalId: 'gated' }), 'gated-1', 'ws-1');
        const gate = createGateEvaluation({
          run,
          policy,
          domainStatuses: { browser: 'failed', security: 'passed' },
          evaluatedAt: '2026-11-27T10:00:00.000Z',
        });
        await store.saveGate(gate);
        const saved = await store.getRunGate('ws-1', run.id);
        // The durable store keys the row by a UUID of the id; what the gate is about is unchanged.
        expect(saved).toMatchObject({
          runId: run.id,
          policyId: policy.id,
          policyHash: policy.hash,
        });
        expect(saved?.decision).toBe(gate.decision);
        expect(saved?.reasons).toEqual(gate.reasons);
        expect(saved?.domainStatuses).toEqual(gate.domainStatuses);
        expect(await store.getRunGate('ws-2', run.id)).toBeNull();
      } finally {
        await close();
      }
    });
  });
}
