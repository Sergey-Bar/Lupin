/**
 * Failure causes, computed by a job and stored (plan task 11).
 *
 * The insights page used to cluster every failure in its window on every read. The job below
 * reads each workspace's last {@link CLUSTER_HISTORY_DAYS} days once, clusters them with
 * `clusterFailures` from `@lupin/reporting`, and replaces the stored rows for that workspace
 * and project, so a read costs one indexed query. A full recompute rather than an increment
 * per run: it is idempotent, so a restart or a second process cannot count a run twice.
 *
 * Rows are keyed `(workspace_id, project_key, fingerprint)`; `project_key` is the project id, or
 * `''` for every project, which is the scope a page with no project chosen reads.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import { failureClusters, workspaces } from '@lupin/db';
import { clusterFailures, type FailureClusters } from '@lupin/reporting';
import { belongsTo, failureInputsOf } from '../execution/insights.js';
import { readSince, startOfDay } from '../execution/trend.js';
import type { ExecutionRun, ExecutionStore } from '../execution/types.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

type Db = ProjectRegistryServiceOptions['db'];

export const CLUSTER_HISTORY_DAYS = 90;
/** The most causes kept per scope: the page shows the top ones, ranked by count. */
export const MAX_STORED_CLUSTERS = 200;
const DAY_MS = 86_400_000;

/** Replaces one scope's stored causes with `clustered`. */
export async function storeClusters(
  db: Db,
  workspaceId: string,
  projectKey: string,
  clustered: FailureClusters,
  now: Date,
): Promise<void> {
  const keep = clustered.clusters.map((cluster) => cluster.signature);
  await db
    .delete(failureClusters)
    .where(
      and(
        eq(failureClusters.workspaceId, workspaceId),
        eq(failureClusters.projectKey, projectKey),
        ...(keep.length === 0 ? [] : [notInArray(failureClusters.fingerprint, keep)]),
      ),
    );
  for (const cluster of clustered.clusters) {
    const values = {
      clusterLabel: cluster.signature.slice(0, 200),
      occurrenceCount: cluster.count,
      representativeError: cluster.sampleMessage,
      errorType: cluster.errorType,
      firstSeenAt: new Date(cluster.firstSeen),
      lastSeenAt: new Date(cluster.lastSeen),
      runCount: cluster.runs,
      tests: cluster.tests,
      branches: cluster.branches,
      updatedAt: now,
    };
    await db
      .insert(failureClusters)
      .values({
        id: randomUUID(),
        workspaceId,
        projectKey,
        fingerprint: cluster.signature,
        createdAt: now,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          failureClusters.workspaceId,
          failureClusters.projectKey,
          failureClusters.fingerprint,
        ],
        set: values,
      });
  }
}

/** The stored causes of one scope, most frequent first; `null` when the job has stored none. */
export async function readStoredClusters(
  db: Db,
  workspaceId: string,
  projectKey: string,
  limit: number,
): Promise<FailureClusters | null> {
  const scope = and(
    eq(failureClusters.workspaceId, workspaceId),
    eq(failureClusters.projectKey, projectKey),
  );
  const [totals] = await db
    .select({
      causes: sql<number>`count(*)::int`,
      failures: sql<number>`coalesce(sum(${failureClusters.occurrenceCount}), 0)::int`,
    })
    .from(failureClusters)
    .where(scope);
  if (totals === undefined || totals.causes === 0) return null;
  const rows = await db
    .select()
    .from(failureClusters)
    .where(scope)
    .orderBy(desc(failureClusters.occurrenceCount), failureClusters.fingerprint)
    .limit(limit);
  return {
    clusters: rows.map((row) => ({
      signature: row.fingerprint,
      errorType: row.errorType,
      sampleMessage: row.representativeError,
      count: row.occurrenceCount,
      tests: row.tests,
      branches: row.branches,
      runs: Math.max(1, row.runCount),
      firstSeen: (row.firstSeenAt ?? row.createdAt).toISOString(),
      lastSeen: (row.lastSeenAt ?? row.updatedAt).toISOString(),
    })),
    totals: { failures: totals.failures, causes: totals.causes },
  };
}

/** The scopes a set of runs covers: every project, and each project a run names. */
function scopesOf(runs: readonly ExecutionRun[]): string[] {
  const projects = new Set<string>();
  for (const run of runs) if (run.projectId !== null) projects.add(run.projectId);
  return ['', ...[...projects].sort()];
}

/** Recomputes and stores every scope of one workspace. Returns how many causes it stored. */
export async function refreshWorkspaceClusters(
  db: Db,
  store: ExecutionStore,
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  const since = startOfDay(now).getTime() - (CLUSTER_HISTORY_DAYS - 1) * DAY_MS;
  const { runs } = await readSince(store, workspaceId, since);
  let stored = 0;
  for (const projectKey of scopesOf(runs)) {
    const scoped = projectKey === '' ? runs : runs.filter((run) => belongsTo(run, projectKey));
    const clustered = clusterFailures(failureInputsOf(scoped), {
      maxClusters: MAX_STORED_CLUSTERS,
    });
    await storeClusters(db, workspaceId, projectKey, clustered, now);
    stored += clustered.clusters.length;
  }
  return stored;
}

/** The job: every workspace, one after another. A workspace that fails does not stop the rest. */
export async function refreshAllClusters(
  db: Db,
  store: ExecutionStore,
  onError: (workspaceId: string, error: unknown) => void,
  now: Date = new Date(),
): Promise<number> {
  const ids = await db.select({ id: workspaces.id }).from(workspaces);
  let stored = 0;
  for (const { id } of ids) {
    try {
      stored += await refreshWorkspaceClusters(db, store, id, now);
    } catch (error) {
      onError(id, error);
    }
  }
  return stored;
}
