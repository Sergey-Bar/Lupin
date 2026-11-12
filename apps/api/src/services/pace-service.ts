import { and, desc, eq, gte, inArray, isNotNull, min, sql } from 'drizzle-orm';
import { deliverySources, diffCoverageResults, pullRequests, runs, tests } from '@lupin/db';
import { paceReport, weekStartOf, type PaceMerge } from '@lupin/reporting';
import type { AiAttribution, PaceReport } from '@lupin/shared-contracts';
import { withinBound } from './bounded-list.js';
import { projectRow, type HealthStoreOptions } from './health-findings.js';

/**
 * Pace for one project: the merged pull requests of the window with their head's diff coverage,
 * and the test identities first seen in it, handed to the pure `paceReport`.
 *
 * A project with no delivery source enabled has no merges to read, which is `not_configured`;
 * a project whose runs carry no project id has no tests to date, which is "not measured".
 */
export type PaceOptions = HealthStoreOptions & { now?: () => Date };

export const PACE_DEFAULT_WEEKS = 8;
/** Merged pull requests read per report; more is `truncated`. */
export const PACE_MERGE_LIMIT = 5000;
const CHUNK = 500;

async function syncEnabled(options: PaceOptions, projectId: string): Promise<boolean> {
  const [source] = await options.db
    .select({ enabled: deliverySources.enabled })
    .from(deliverySources)
    .where(
      and(
        eq(deliverySources.workspaceId, options.workspaceId),
        eq(deliverySources.projectId, projectId),
      ),
    )
    .limit(1);
  return source?.enabled === true;
}

async function mergesSince(options: PaceOptions, projectId: string, since: Date) {
  return options.db
    .select({
      mergedAt: pullRequests.mergedAt,
      additions: pullRequests.additions,
      deletions: pullRequests.deletions,
      attribution: pullRequests.attribution,
      testsTouched: pullRequests.testsTouched,
      headSha: pullRequests.headSha,
    })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.workspaceId, options.workspaceId),
        eq(pullRequests.projectId, projectId),
        eq(pullRequests.state, 'merged'),
        isNotNull(pullRequests.mergedAt),
        gte(pullRequests.mergedAt, since),
      ),
    )
    .orderBy(desc(pullRequests.mergedAt))
    .limit(PACE_MERGE_LIMIT + 1);
}

/** Head sha → its diff coverage, computed results only. */
async function coverageByHead(options: PaceOptions, projectId: string, heads: readonly string[]) {
  const coverage = new Map<string, { executable: number; covered: number }>();
  for (let index = 0; index < heads.length; index += CHUNK) {
    const chunk = heads.slice(index, index + CHUNK);
    const rows = await options.db
      .select({
        sha: diffCoverageResults.commitSha,
        executable: diffCoverageResults.executable,
        covered: diffCoverageResults.covered,
      })
      .from(diffCoverageResults)
      .where(
        and(
          eq(diffCoverageResults.workspaceId, options.workspaceId),
          eq(diffCoverageResults.projectId, projectId),
          inArray(diffCoverageResults.commitSha, withinBound(chunk, CHUNK)),
          isNotNull(diffCoverageResults.ratio),
        ),
      );
    for (const row of rows) {
      if (row.executable === null || row.covered === null || coverage.has(row.sha)) continue;
      coverage.set(row.sha, { executable: row.executable, covered: row.covered });
    }
  }
  return coverage;
}

/** When each of the project's test identities was first seen, for those first seen since `since`. */
async function firstSeenSince(
  options: PaceOptions,
  projectId: string,
  since: Date,
): Promise<Date[] | null> {
  const [any] = await options.db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.workspaceId, options.workspaceId), eq(runs.projectId, projectId)))
    .limit(1);
  if (any === undefined) return null;
  const first = min(runs.startedAt);
  const rows = await options.db
    .select({ at: first })
    .from(tests)
    .innerJoin(runs, eq(runs.id, tests.runId))
    .where(
      and(
        eq(tests.workspaceId, options.workspaceId),
        eq(runs.workspaceId, options.workspaceId),
        eq(runs.projectId, projectId),
      ),
    )
    .groupBy(tests.stableId)
    .having(sql`${first} >= ${since}`);
  return rows.flatMap((row) => (row.at === null ? [] : [new Date(row.at)]));
}

export async function projectPace(
  options: PaceOptions,
  projectId: string,
  weeks: number = PACE_DEFAULT_WEEKS,
): Promise<PaceReport> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const count = Math.min(52, Math.max(1, Math.floor(weeks)));
  const since = new Date(weekStartOf(now).getTime() - (count - 1) * 7 * 86_400_000);
  const [enabled, rows, firstSeen] = await Promise.all([
    syncEnabled(options, project.id),
    mergesSince(options, project.id, since),
    firstSeenSince(options, project.id, since),
  ]);
  const read = rows.slice(0, PACE_MERGE_LIMIT);
  const heads = [
    ...new Set(read.flatMap((row) => (row.headSha === null ? [] : [row.headSha.toLowerCase()]))),
  ];
  const coverage = await coverageByHead(options, project.id, heads);
  // A project the sync never read, and that has no merged row anyway, has nothing known.
  const merges: PaceMerge[] | null =
    !enabled && read.length === 0
      ? null
      : read.map((row) => ({
          mergedAt: row.mergedAt as Date,
          additions: row.additions,
          deletions: row.deletions,
          attribution: row.attribution as AiAttribution,
          testsTouched: row.testsTouched,
          coverage: row.headSha === null ? null : (coverage.get(row.headSha.toLowerCase()) ?? null),
        }));
  return paceReport({
    projectId: project.id,
    now,
    weeks: count,
    merges,
    firstSeen,
    truncated: rows.length > PACE_MERGE_LIMIT,
  });
}
