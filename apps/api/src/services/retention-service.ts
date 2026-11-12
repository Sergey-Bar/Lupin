/**
 * Run retention per workspace (plan task 14).
 *
 * A workspace may keep its runs for a number of days; `null` keeps them. The sweep removes
 * each run older than that with its test results, events, jobs, gate evaluations and artifacts
 * (all `on delete cascade` onto `runs`), and the artifact bytes first, so a deleted row never
 * leaves its object behind. A run with **any** artifact under `legal_hold` is never removed, and
 * neither are its artifacts. Each pass that removed something writes one audit row with what
 * it removed.
 *
 * Bytes are deleted before rows, one run at a time: if a byte delete fails, that run is kept
 * and reported, and the next pass tries it again. The reverse order would lose the key.
 */
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { artifacts, runs, workspaces } from '@lupin/db';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { ArtifactBytesStore } from '../infrastructure/artifact-store.js';
import { audit } from './access-service.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

type Db = ProjectRegistryServiceOptions['db'];
type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;

const DAY_MS = 86_400_000;
/** The most runs one pass removes per workspace, so a first sweep cannot hold a lock for long. */
export const SWEEP_BATCH = 500;
/** The longest retention a workspace can set: ten years. */
export const MAX_RETENTION_DAYS = 3650;

export interface RetentionPolicy {
  runDays: number | null;
}

export async function readRetention(options: Options): Promise<RetentionPolicy> {
  const [row] = await options.db
    .select({ days: workspaces.runRetentionDays })
    .from(workspaces)
    .where(eq(workspaces.id, options.workspaceId))
    .limit(1);
  return { runDays: row?.days ?? null };
}

export async function setRetention(
  options: Options,
  runDays: number | null,
  actor: string,
): Promise<RetentionPolicy> {
  if (
    runDays !== null &&
    (!Number.isInteger(runDays) || runDays < 1 || runDays > MAX_RETENTION_DAYS)
  ) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      `Retention is a whole number of days from 1 to ${String(MAX_RETENTION_DAYS)}, or none`,
    );
  }
  await options.db
    .update(workspaces)
    .set({ runRetentionDays: runDays })
    .where(eq(workspaces.id, options.workspaceId));
  await audit(options, {
    actor,
    action: 'retention.set',
    resourceType: 'workspace',
    resourceId: options.workspaceId,
    details: { runDays },
  });
  return { runDays };
}

export interface SweepReport {
  workspaceId: string;
  runsRemoved: number;
  artifactsRemoved: number;
  /** Runs kept because an artifact of theirs is under legal hold. */
  heldRuns: number;
  /** Runs kept because a byte delete failed; tried again next pass. */
  failedRuns: number;
}

/** One workspace's pass. A workspace with no policy is untouched. */
export async function sweepWorkspace(
  db: Db,
  bytes: Pick<ArtifactBytesStore, 'delete'> | undefined,
  workspaceId: string,
  now: Date = new Date(),
): Promise<SweepReport> {
  const report: SweepReport = {
    workspaceId,
    runsRemoved: 0,
    artifactsRemoved: 0,
    heldRuns: 0,
    failedRuns: 0,
  };
  const { runDays } = await readRetention({ db, workspaceId });
  if (runDays === null) return report;
  const cutoff = new Date(now.getTime() - runDays * DAY_MS);
  const held = sql`exists (select 1 from ${artifacts} a where a.run_id = ${runs.id} and a.legal_hold)`;
  const old = and(eq(runs.workspaceId, workspaceId), lt(runs.createdAt, cutoff));
  const [heldCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(old, held));
  report.heldRuns = heldCount?.n ?? 0;
  const candidates = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(old, sql`not ${held}`))
    .limit(SWEEP_BATCH);
  for (const { id } of candidates) {
    const keys = await db
      .select({ key: artifacts.storageKey })
      .from(artifacts)
      .where(eq(artifacts.runId, id));
    try {
      for (const { key } of keys) await bytes?.delete(key);
    } catch {
      report.failedRuns += 1;
      continue;
    }
    await db.delete(runs).where(and(eq(runs.workspaceId, workspaceId), inArray(runs.id, [id])));
    report.runsRemoved += 1;
    report.artifactsRemoved += keys.length;
  }
  if (report.runsRemoved > 0 || report.failedRuns > 0) {
    await audit(
      { db, workspaceId },
      {
        actor: 'system:retention',
        action: 'retention.sweep',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: { runDays, cutoff: cutoff.toISOString(), ...report },
      },
    );
  }
  return report;
}

/** Every workspace with a policy; one that fails does not stop the rest. */
export async function sweepAllWorkspaces(
  db: Db,
  bytes: Pick<ArtifactBytesStore, 'delete'> | undefined,
  onError: (workspaceId: string, error: unknown) => void,
  now: Date = new Date(),
): Promise<SweepReport[]> {
  const ids = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(isNotNull(workspaces.runRetentionDays));
  const reports: SweepReport[] = [];
  for (const { id } of ids) {
    try {
      reports.push(await sweepWorkspace(db, bytes, id, now));
    } catch (error) {
      onError(id, error);
    }
  }
  return reports;
}
