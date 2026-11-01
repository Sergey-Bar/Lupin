import { and, desc, eq, gte } from 'drizzle-orm';
import {
  deliverySources,
  deployments,
  healthSnapshots,
  projects,
  pullRequests,
  runs,
  scanSnapshots,
} from '@lupin/db';
import {
  buildCockpit,
  type CockpitChange,
  type CockpitDeployment,
  type CockpitDimension,
  type CockpitHealthPoint,
  type CockpitLetter,
  type CockpitPullRequest,
  type CockpitRun,
  type CockpitScanPoint,
} from '@lupin/reporting';
import { HealthGradeSchema, type Cockpit, type CockpitWindow } from '@lupin/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { branchFor, projectRow, type HealthStoreOptions } from './health-findings.js';
import { githubRepository } from './health-integrations.js';
import { healthPolicyOf } from './repo-health-service.js';
import { productionEnvironmentsOf } from './delivery-service.js';

/**
 * The cockpit read: loads the stored readings of one project and hands them to the pure
 * {@link buildCockpit}. Every query is scoped to the caller's workspace first.
 *
 * What it reads is history, never an input to a decision. The live grade and the gates are
 * computed elsewhere; the cockpit only says how the readings changed.
 *
 * Reads are bounded: {@link READ_DAYS} days back, and a row limit per table. A "since the last
 * release" older than that has no baseline in the window and says `no_baseline`; it does not
 * reach for older rows it did not load.
 */
export type CockpitOptions = HealthStoreOptions & { now?: () => Date };

export const COCKPIT_READ_DAYS = 90;
export const COCKPIT_READ_LIMIT = 5000;
const DAY_MS = 86_400_000;

const DIMENSIONS: readonly CockpitDimension[] = [
  'security',
  'tests',
  'code-quality',
  'dependencies',
];

/**
 * The project a cockpit with no project named means: the one with the most recent health
 * reading, else the most recently created. `null` with no projects at all.
 */
async function defaultProjectId(options: CockpitOptions): Promise<string | null> {
  const latestReading = await options.db
    .select({ projectId: healthSnapshots.projectId })
    .from(healthSnapshots)
    .where(eq(healthSnapshots.workspaceId, options.workspaceId))
    .orderBy(desc(healthSnapshots.takenAt))
    .limit(1);
  if (latestReading[0] !== undefined) return latestReading[0].projectId;
  const newest = await options.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId))
    .orderBy(desc(projects.createdAt))
    .limit(1);
  return newest[0]?.id ?? null;
}

function attributionOf(value: string): CockpitChange['attribution'] {
  return value === 'agent-authored' || value === 'ai-assisted' || value === 'human'
    ? value
    : 'unknown';
}

function dimensionScores(grade: unknown): CockpitHealthPoint['dimensions'] {
  const parsed = HealthGradeSchema.safeParse(grade);
  if (!parsed.success) return {};
  const scores: CockpitHealthPoint['dimensions'] = {};
  for (const entry of parsed.data.dimensions) {
    if ((DIMENSIONS as readonly string[]).includes(entry.dimension)) {
      scores[entry.dimension as CockpitDimension] = entry.score;
    }
  }
  return scores;
}

export async function cockpit(
  options: CockpitOptions,
  query: { projectId?: string | undefined; branch?: string | undefined; window: CockpitWindow },
): Promise<Cockpit> {
  const now = options.now?.() ?? new Date();
  const projectId = query.projectId ?? (await defaultProjectId(options));
  if (projectId === null) {
    throw new DomainError(ErrorCode.NOT_FOUND, 'This workspace has no project to show');
  }
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, query.branch);
  const since = new Date(now.getTime() - COCKPIT_READ_DAYS * DAY_MS);
  const scoped = <T extends { workspaceId: unknown; projectId: unknown }>(table: T) =>
    and(
      eq(table.workspaceId as typeof healthSnapshots.workspaceId, options.workspaceId),
      eq(table.projectId as typeof healthSnapshots.projectId, project.id),
    );

  const [healthRows, scanRows, runRows, pullRequestRows, deploymentRows, sourceRows] =
    await Promise.all([
      options.db
        .select()
        .from(healthSnapshots)
        .where(
          and(
            scoped(healthSnapshots),
            eq(healthSnapshots.branch, branch),
            gte(healthSnapshots.takenAt, since),
          ),
        )
        .orderBy(desc(healthSnapshots.takenAt))
        .limit(COCKPIT_READ_LIMIT),
      options.db
        .select()
        .from(scanSnapshots)
        .where(and(scoped(scanSnapshots), gte(scanSnapshots.takenAt, since)))
        .orderBy(desc(scanSnapshots.takenAt))
        .limit(COCKPIT_READ_LIMIT),
      options.db
        .select({
          id: runs.id,
          startedAt: runs.startedAt,
          commitSha: runs.commitSha,
          commit: runs.commit,
          status: runs.status,
          prNumber: runs.prNumber,
        })
        .from(runs)
        .where(
          and(
            eq(runs.workspaceId, options.workspaceId),
            eq(runs.projectId, project.id),
            gte(runs.startedAt, since),
          ),
        )
        .orderBy(desc(runs.startedAt))
        .limit(COCKPIT_READ_LIMIT),
      options.db
        .select({
          number: pullRequests.number,
          title: pullRequests.title,
          mergedAt: pullRequests.mergedAt,
          mergeCommitSha: pullRequests.mergeCommitSha,
          headSha: pullRequests.headSha,
          baseBranch: pullRequests.baseBranch,
          additions: pullRequests.additions,
          deletions: pullRequests.deletions,
          attribution: pullRequests.attribution,
          state: pullRequests.state,
          draft: pullRequests.draft,
          openedAt: pullRequests.openedAt,
          testsTouched: pullRequests.testsTouched,
          humanApprovalCount: pullRequests.humanApprovalCount,
        })
        .from(pullRequests)
        .where(and(scoped(pullRequests), gte(pullRequests.lastActivityAt, since)))
        .orderBy(desc(pullRequests.lastActivityAt))
        .limit(COCKPIT_READ_LIMIT),
      options.db
        .select({
          createdAt: deployments.createdAt,
          environment: deployments.environment,
          status: deployments.status,
        })
        .from(deployments)
        .where(and(scoped(deployments), gte(deployments.createdAt, since)))
        .orderBy(desc(deployments.createdAt))
        .limit(COCKPIT_READ_LIMIT),
      options.db
        .select({ productionEnvironments: deliverySources.productionEnvironments })
        .from(deliverySources)
        .where(scoped(deliverySources))
        .limit(1),
    ]);

  const health: CockpitHealthPoint[] = healthRows
    .map((row) => ({
      at: row.takenAt,
      score: row.score,
      letter: row.letter as CockpitLetter | null,
      formulaVersion: row.formulaVersion,
      commitSha: row.commitSha,
      dimensions: dimensionScores(row.grade),
    }))
    .reverse();
  const scans: CockpitScanPoint[] = scanRows
    .map((row) => ({ at: row.takenAt, coverage: row.coverage, flakyTests: row.flakyTests }))
    .reverse();
  const runList: CockpitRun[] = runRows.map((row) => ({
    id: row.id,
    startedAt: row.startedAt,
    // `commit_sha` is the canonical column; `commit` is the older spelling some uploads used.
    commitSha: row.commitSha ?? row.commit,
    status: row.status,
    prNumber: row.prNumber,
  }));
  const pullRequestList: CockpitPullRequest[] = pullRequestRows;
  // What landed on the shown branch. The AI attribution is the one the delivery sync stored; the
  // cockpit never classifies a pull request itself.
  const changes: CockpitChange[] = pullRequestRows
    .filter((row) => row.mergedAt !== null && row.baseBranch === branch)
    .map((row) => ({
      mergedAt: row.mergedAt,
      additions: row.additions,
      deletions: row.deletions,
      attribution: attributionOf(row.attribution),
    }));
  const deploymentList: CockpitDeployment[] = deploymentRows.map((row) => ({
    createdAt: row.createdAt,
    environment: row.environment,
    status: row.status === 'success' ? 'success' : 'failure',
  }));

  return buildCockpit({
    project: { id: project.id, name: project.name },
    branch,
    now,
    window: query.window,
    health,
    scans,
    runs: runList,
    pullRequests: pullRequestList,
    changes,
    riskPullRequests: pullRequestRows,
    deployments: deploymentList,
    productionEnvironments: productionEnvironmentsOf(
      healthPolicyOf(project)?.delivery ?? {},
      sourceRows[0] ?? null,
    ),
    repository: githubRepository(project.repositoryUrl),
  });
}
