import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import * as schema from '@lupin/db';
import { createErrorBoundary } from '../errors/boundary.js';
import type { CallerResolver } from '../http/roles.js';
import { createRetentionRoutes } from '../routes/retention.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import type { Caller } from './access-service.js';
import {
  readRetention,
  setRetention,
  sweepAllWorkspaces,
  sweepWorkspace,
} from './retention-service.js';

/** Run retention per workspace (plan task 14), on the real migration graph. */
const NOW = new Date('2026-11-12T12:00:00.000Z');
const DAY = 86_400_000;
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

async function runAged(
  db: MigratedDb,
  workspaceId: string,
  ageDays: number,
  artifact?: { key: string; legalHold: boolean },
): Promise<string> {
  const at = new Date(NOW.getTime() - ageDays * DAY);
  const [row] = await db
    .insert(schema.runs)
    .values({ workspaceId, startedAt: at, createdAt: at } as never)
    .returning({ id: schema.runs.id });
  const id = row?.id ?? '';
  if (artifact !== undefined) {
    await db.insert(schema.artifacts).values({
      workspaceId,
      runId: id,
      kind: 'trace',
      name: 'trace.zip',
      storageKey: artifact.key,
      legalHold: artifact.legalHold,
      contentType: 'application/zip',
      checksum: 'a'.repeat(64),
      sizeBytes: 1,
    });
  }
  return id;
}

const remaining = async (db: MigratedDb, workspaceId: string) =>
  (
    await db
      .select({ id: schema.runs.id })
      .from(schema.runs)
      .where(eq(schema.runs.workspaceId, workspaceId))
  )
    .map((row) => row.id)
    .sort();

describe('run retention', () => {
  it('removes old runs and their artifact bytes, keeps held and recent ones, and audits it', async () => {
    const db = await setup();
    const mine = { db: db as never, workspaceId: 'ws-1' };
    const old = await runAged(db, 'ws-1', 40, { key: 'k-old', legalHold: false });
    const held = await runAged(db, 'ws-1', 40, { key: 'k-held', legalHold: true });
    const recent = await runAged(db, 'ws-1', 5);
    const deleted: string[] = [];
    // No policy: nothing is touched.
    expect(
      (
        await sweepWorkspace(
          db as never,
          { delete: async (key) => void deleted.push(key) },
          'ws-1',
          NOW,
        )
      ).runsRemoved,
    ).toBe(0);
    await setRetention(mine, 30, 'token:admin');
    const report = await sweepWorkspace(
      db as never,
      { delete: async (key) => void deleted.push(key) },
      'ws-1',
      NOW,
    );
    expect(report).toMatchObject({
      runsRemoved: 1,
      artifactsRemoved: 1,
      heldRuns: 1,
      failedRuns: 0,
    });
    expect(deleted).toEqual(['k-old']);
    expect(await remaining(db, 'ws-1')).toEqual([held, recent].sort());
    expect(await remaining(db, 'ws-1')).not.toContain(old);
    const actions = (await db.select().from(schema.auditEvents)).map((event) => event.action);
    expect(actions).toEqual(expect.arrayContaining(['retention.set', 'retention.sweep']));
  });

  it('keeps a run whose bytes could not be deleted, for the next pass', async () => {
    const db = await setup();
    await setRetention({ db: db as never, workspaceId: 'ws-1' }, 1, 'token:admin');
    const run = await runAged(db, 'ws-1', 3, { key: 'k', legalHold: false });
    const report = await sweepWorkspace(
      db as never,
      {
        delete: async () => {
          throw new Error('bucket unavailable');
        },
      },
      'ws-1',
      NOW,
    );
    expect(report).toMatchObject({ runsRemoved: 0, failedRuns: 1 });
    expect(await remaining(db, 'ws-1')).toEqual([run]);
  });

  it("never sweeps another workspace's runs, and refuses a nonsense policy", async () => {
    const db = await setup();
    await setRetention({ db: db as never, workspaceId: 'ws-2' }, 10, 'token:admin');
    const theirs = await runAged(db, 'ws-2', 20);
    const mine = await runAged(db, 'ws-1', 20);
    const reports = await sweepAllWorkspaces(db as never, undefined, () => undefined, NOW);
    expect(reports.map((report) => report.workspaceId)).toEqual(['ws-2']);
    expect(await remaining(db, 'ws-2')).toEqual([]);
    expect(await remaining(db, 'ws-1')).toEqual([mine]);
    expect(theirs).not.toBe('');
    await expect(setRetention({ db: db as never, workspaceId: 'ws-1' }, 0, 'a')).rejects.toThrow(
      /whole number of days/,
    );
    expect(await readRetention({ db: db as never, workspaceId: 'ws-1' })).toEqual({
      runDays: null,
    });
  });

  it('lets a viewer read the policy and only an admin set it, through the routes', async () => {
    const db = await setup();
    const tokens: Record<string, Caller> = {
      lup_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
      lup_admin: { actor: 'token:admin', role: 'admin', uploaderFor: null },
    };
    const access: CallerResolver = {
      mode: 'enforced',
      authenticateToken: async (token) => tokens[token] ?? null,
      hasSession: async () => false,
    };
    const { onError } = createErrorBoundary({
      log: () => undefined,
      reportError: () => undefined,
      requestId: () => 'R',
    });
    const app = new Hono()
      .onError(onError)
      .route('/', createRetentionRoutes({ db: db as never, workspaceId: 'ws-1', access }));
    const put = (token: string, body: unknown) =>
      app.request('/api/v1/retention', {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await put('lup_viewer', { runDays: 30 })).status).toBe(403);
    expect((await put('lup_admin', { runDays: 0 })).status).toBe(400);
    expect(await (await put('lup_admin', { runDays: 30 })).json()).toEqual({ runDays: 30 });
    const read = await app.request('/api/v1/retention', {
      headers: { authorization: 'Bearer lup_viewer' },
    });
    expect(await read.json()).toEqual({ runDays: 30 });
    expect(await (await put('lup_admin', { runDays: null })).json()).toEqual({ runDays: null });
  });
});
