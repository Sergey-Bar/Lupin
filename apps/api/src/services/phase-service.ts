import { and, asc, desc, eq, gte, inArray, or } from 'drizzle-orm';
import {
  deliverySources,
  projects,
  pullRequestRiskAssessments,
  pullRequests,
  runs,
} from '@lupin/db';
import {
  PHASE_THRESHOLD_HOURS,
  SDLC_VERSION,
  linksAnIssue,
  phaseBand,
  phaseStrip,
  type PhaseInput,
} from '@lupin/reporting';
import {
  STUCK_LIST_LIMIT,
  changeRiskRank,
  type AiAttribution,
  type ChangeRiskLevel,
  type PhaseStrip,
  type PortfolioPhases,
  type RepositoryPhases,
  type SdlcPhase,
} from '@lupin/shared-contracts';
import { withinBound } from './bounded-list.js';
import { tamperForRisk } from './diff-guard-service.js';
import { projectRow, type HealthStoreOptions } from './health-findings.js';

/**
 * The SDLC phases of a repository's changes, read from what this install holds: the synced pull
 * request (body, timestamps, approvals), the test runs on its head, `lupin diff-guard`, and the
 * change-risk assessment. Every read starts from `workspace_id`.
 *
 * Not read yet, and so `not_measured` rather than guessed: whether the gate passed on a merged
 * head (an assessment records the risk, not the verdict).
 */
export type PhaseOptions = HealthStoreOptions & { now?: () => Date };

export const PHASE_WINDOW_DAYS = 30;
/** Changes read per repository; more is `truncated`. */
export const PHASE_CHANGE_LIMIT = 500;
export const PORTFOLIO_PHASE_LIMIT = 50;
const DAY = 86_400_000;

type PullRow = typeof pullRequests.$inferSelect;

/** Head sha → the newest run's test total on it, for the project. */
async function testsOnHeads(options: PhaseOptions, projectId: string, heads: readonly string[]) {
  const totals = new Map<string, number>();
  if (heads.length === 0) return totals;
  const rows = await options.db
    .select({ sha: runs.commitSha, total: runs.total })
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, options.workspaceId),
        eq(runs.projectId, projectId),
        inArray(runs.commitSha, withinBound(heads, PHASE_CHANGE_LIMIT)),
      ),
    )
    .orderBy(desc(runs.startedAt));
  for (const row of rows) {
    if (row.sha !== null && !totals.has(row.sha.toLowerCase()))
      totals.set(row.sha.toLowerCase(), row.total);
  }
  return totals;
}

/** `projectId:number` → the latest assessed risk level. */
async function riskLevels(options: PhaseOptions, projectId: string, numbers: readonly number[]) {
  const levels = new Map<number, ChangeRiskLevel>();
  if (numbers.length === 0) return levels;
  const rows = await options.db
    .select({
      number: pullRequestRiskAssessments.prNumber,
      level: pullRequestRiskAssessments.level,
    })
    .from(pullRequestRiskAssessments)
    .where(
      and(
        eq(pullRequestRiskAssessments.workspaceId, options.workspaceId),
        eq(pullRequestRiskAssessments.projectId, projectId),
        inArray(pullRequestRiskAssessments.prNumber, withinBound(numbers, PHASE_CHANGE_LIMIT)),
      ),
    )
    .orderBy(desc(pullRequestRiskAssessments.assessedAt));
  for (const row of rows) {
    if (!levels.has(row.number)) levels.set(row.number, row.level as ChangeRiskLevel);
  }
  return levels;
}

/** The phase model's input for one synced pull request. */
export function phaseInputOf(
  row: Pick<
    PullRow,
    | 'number'
    | 'state'
    | 'draft'
    | 'attribution'
    | 'body'
    | 'firstCommitAt'
    | 'openedAt'
    | 'firstReviewAt'
    | 'approvedAt'
    | 'humanApprovalCount'
    | 'mergedAt'
  >,
  extra: {
    now: Date;
    testTotal: number | undefined;
    tampered: boolean;
    level: ChangeRiskLevel | undefined;
  },
): PhaseInput {
  return {
    pullRequest: row.number,
    now: extra.now,
    state: row.state as PhaseInput['state'],
    draft: row.draft,
    attribution: row.attribution as AiAttribution,
    highRisk: extra.level !== undefined && changeRiskRank(extra.level) >= changeRiskRank('high'),
    linkedIssue: linksAnIssue(row.body),
    firstCommitAt: row.firstCommitAt,
    openedAt: row.openedAt,
    testsOnHead:
      extra.testTotal === undefined ? null : { ran: extra.testTotal > 0, tampered: extra.tampered },
    firstReviewAt: row.firstReviewAt,
    approvedAt: row.approvedAt,
    humanApprovals: row.humanApprovalCount,
    mergedAt: row.mergedAt,
    gatePassedAtMerge: null,
  };
}

async function stripsOf(
  options: PhaseOptions,
  projectId: string,
  rows: readonly PullRow[],
  now: Date,
) {
  const heads = [
    ...new Set(rows.flatMap((row) => (row.headSha === null ? [] : [row.headSha.toLowerCase()]))),
  ];
  const [totals, levels] = await Promise.all([
    testsOnHeads(options, projectId, heads),
    riskLevels(
      options,
      projectId,
      rows.map((row) => row.number),
    ),
  ]);
  const strips: Array<{ row: PullRow; strip: PhaseStrip }> = [];
  for (const row of rows) {
    const head = row.headSha?.toLowerCase() ?? null;
    const tamper = head === null ? null : await tamperForRisk(options, projectId, head);
    const strip = phaseStrip(
      phaseInputOf(row, {
        now,
        testTotal: head === null ? undefined : totals.get(head),
        tampered: (tamper?.findings ?? 0) > 0,
        level: levels.get(row.number),
      }),
    );
    strips.push({ row, strip });
  }
  return strips;
}

/** One pull request's strip; `null` when the sync has not read it. */
export async function pullRequestPhases(
  options: PhaseOptions,
  projectId: string,
  number: number,
): Promise<PhaseStrip | null> {
  const project = await projectRow(options, projectId);
  const [row] = await options.db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.workspaceId, options.workspaceId),
        eq(pullRequests.projectId, project.id),
        eq(pullRequests.number, number),
      ),
    )
    .orderBy(desc(pullRequests.syncedAt))
    .limit(1);
  if (row === undefined) return null;
  const [entry] = await stripsOf(options, project.id, [row], options.now?.() ?? new Date());
  return entry?.strip ?? null;
}

/** Changes open now, or merged or closed since `since`. */
async function changesSince(options: PhaseOptions, projectId: string, since: Date, limit: number) {
  return options.db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.workspaceId, options.workspaceId),
        eq(pullRequests.projectId, projectId),
        or(eq(pullRequests.state, 'open'), gte(pullRequests.lastActivityAt, since)),
      ),
    )
    .orderBy(desc(pullRequests.lastActivityAt))
    .limit(limit + 1);
}

async function configuredFor(options: PhaseOptions, projectIds: readonly string[]) {
  if (projectIds.length === 0) return new Set<string>();
  const rows = await options.db
    .select({ projectId: deliverySources.projectId })
    .from(deliverySources)
    .where(
      and(
        eq(deliverySources.workspaceId, options.workspaceId),
        inArray(deliverySources.projectId, withinBound(projectIds, PORTFOLIO_PHASE_LIMIT)),
        eq(deliverySources.enabled, true),
      ),
    );
  return new Set(rows.map((row) => row.projectId));
}

const LABEL: Readonly<Record<SdlcPhase, string>> = {
  plan: 'Plan',
  code: 'Code',
  test: 'Test',
  review: 'Review',
  release: 'Release',
};

function bottleneckOf(band: RepositoryPhases['phases']): RepositoryPhases['bottleneck'] {
  const worst = [...band].filter((entry) => entry.stuck > 0).sort((a, b) => b.stuck - a.stuck)[0];
  if (worst === undefined) return null;
  const limit =
    worst.phase === 'code' || worst.phase === 'review' || worst.phase === 'release'
      ? PHASE_THRESHOLD_HOURS[worst.phase]
      : null;
  const over = limit === null ? '' : ` over ${String(limit)} hours`;
  const changes = `${String(worst.stuck)} ${worst.stuck === 1 ? 'change' : 'changes'}`;
  return {
    phase: worst.phase,
    sentence: `${LABEL[worst.phase]} is the bottleneck: ${changes} waiting${over}.`,
  };
}

export async function repositoryPhases(
  options: PhaseOptions,
  projectId: string,
  windowDays = PHASE_WINDOW_DAYS,
): Promise<RepositoryPhases> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const since = new Date(now.getTime() - windowDays * DAY);
  const rows = await changesSince(options, project.id, since, PHASE_CHANGE_LIMIT);
  const read = rows.slice(0, PHASE_CHANGE_LIMIT);
  const strips = await stripsOf(options, project.id, read, now);
  const band = phaseBand(strips.map((entry) => entry.strip));
  const stuck = strips
    .flatMap(({ row, strip }) =>
      strip.phases
        .filter(
          (step) => step.state === 'in_progress' && step.shape === 'caution' && step.hours !== null,
        )
        .map((step) => ({
          pullRequest: row.number,
          title: row.title,
          phase: step.phase,
          hours: step.hours as number,
        })),
    )
    .sort((a, b) => b.hours - a.hours)
    .slice(0, STUCK_LIST_LIMIT);
  const configured =
    (await configuredFor(options, [project.id])).has(project.id) || read.length > 0;
  return {
    projectId: project.id,
    version: SDLC_VERSION,
    evaluatedAt: now.toISOString(),
    windowDays,
    changes: read.length,
    phases: band,
    bottleneck: bottleneckOf(band),
    stuck,
    truncated: rows.length > PHASE_CHANGE_LIMIT,
    configured,
  };
}

/** Every repository's shape per phase, worst first. */
export async function portfolioPhases(
  options: PhaseOptions,
  windowDays = PHASE_WINDOW_DAYS,
): Promise<PortfolioPhases> {
  const now = options.now?.() ?? new Date();
  const all = await options.db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId))
    .orderBy(asc(projects.name));
  const shown = all.slice(0, PORTFOLIO_PHASE_LIMIT);
  const rows: PortfolioPhases['projects'] = [];
  for (const project of shown) {
    const read = await repositoryPhases(options, project.id, windowDays);
    rows.push({
      projectId: project.id,
      name: project.name,
      changes: read.changes,
      configured: read.configured,
      phases: read.phases.map((entry) => ({ phase: entry.phase, shape: entry.shape })),
    });
  }
  const rank = { bad: 0, caution: 1, unknown: 2, good: 3 } as const;
  const worst = (row: PortfolioPhases['projects'][number]) =>
    Math.min(...row.phases.map((entry) => rank[entry.shape]));
  rows.sort((a, b) => worst(a) - worst(b) || a.name.localeCompare(b.name));
  return {
    evaluatedAt: now.toISOString(),
    windowDays,
    projects: rows,
    total: all.length,
    truncated: all.length > shown.length,
  };
}
