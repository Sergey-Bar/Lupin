import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { auditEvents, runs } from '@lupin/db';
import { withErrorBoundary } from '../../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../../test-support/migrated-database.js';
import { DrizzleRunRepository } from '../../repositories/drizzle-run-repository.js';
import { InMemoryRunRepository } from '../../repositories/in-memory-run-repository.js';
import type { RunRecord, RunRepository } from '../../repositories/run-repository.js';
import { DrizzleAuditSink, type AuditEntry, type AuditSink } from './audit-sink.js';
import { createDashboardRunsRoutes } from './runs.js';

/**
 * A run's status change and its audit row are one unit (plan 1795712849115 task 3, the D2
 * leftover of ledger MNT-171).
 *
 * The route used to write the status, then record the audit row as a second statement. When
 * the second one failed the request answered 500, and the run had moved anyway, with no
 * record of who moved it: the one outcome the audit trail exists to rule out.
 */

const WORKSPACE = 'ws-1';

function runRecord(id: string): RunRecord {
  return {
    id,
    workspaceId: WORKSPACE,
    startedAt: '2026-11-26T00:00:00.000Z',
    finishedAt: null,
    status: 'running',
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: null,
    branch: 'main',
  } as RunRecord;
}

/** A sink whose insert fails, the way a full disk or a dropped connection fails it. */
const failingSink: AuditSink = {
  record: async (_entry: AuditEntry) => {
    throw new Error('audit insert failed');
  },
};

function mount(repository: RunRepository, audit: AuditSink) {
  return withErrorBoundary(
    createDashboardRunsRoutes({
      repository,
      audit,
      contextFor: () => ({ actorId: 'user:7', actorType: 'user' }),
    }),
  );
}

async function patchStatus(app: ReturnType<typeof mount>, id: string, status: string) {
  return await app.request(`/api/v1/dashboard/runs/${id}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

describe('on PostgreSQL, the status write and its audit row commit together', () => {
  let db: MigratedDb;
  let close: () => Promise<void>;
  let repository: DrizzleRunRepository;
  let id: string;

  beforeEach(async () => {
    ({ db, close } = await migratedDatabase());
    repository = new DrizzleRunRepository(db, WORKSPACE);
    id = randomUUID();
    await repository.upsertRun(runRecord(id));
  });

  afterEach(async () => {
    await close();
  });

  it('writes the status and exactly one audit row naming the caller', async () => {
    const response = await patchStatus(
      mount(repository, new DrizzleAuditSink(db, WORKSPACE)),
      id,
      'interrupted',
    );
    expect(response.status).toBe(200);
    const [row] = await db.select().from(runs).where(eq(runs.id, id));
    expect(row?.status).toBe('interrupted');
    const trail = await db.select().from(auditEvents).where(eq(auditEvents.resourceId, id));
    expect(trail.map((entry) => [entry.action, entry.actorId, entry.workspaceId])).toEqual([
      ['run.status_changed', 'user:7', WORKSPACE],
    ]);
  });

  it('leaves the run where it was when the audit row cannot be written', async () => {
    // The audit insert fails inside the database, the way a constraint or a full disk fails
    // it. A repository that writes the two separately has already committed the status.
    await db.execute(sql`
      CREATE FUNCTION refuse_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit insert failed'; END $$ LANGUAGE plpgsql`);
    await db.execute(
      sql`CREATE TRIGGER refuse_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION refuse_audit()`,
    );

    const response = await patchStatus(
      mount(repository, new DrizzleAuditSink(db, WORKSPACE)),
      id,
      'interrupted',
    );

    expect(response.status).toBe(500);
    const [row] = await db.select().from(runs).where(eq(runs.id, id));
    expect(row?.status).toBe('running');
    expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId, id))).toEqual([]);
  });
});

describe('in memory, a failed record puts the run back', () => {
  it('restores the previous status when the sink refuses the entry', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(runRecord('run-1'));

    const response = await patchStatus(mount(repository, failingSink), 'run-1', 'interrupted');

    expect(response.status).toBe(500);
    expect((await repository.getRun('run-1'))?.status).toBe('running');
  });
});
