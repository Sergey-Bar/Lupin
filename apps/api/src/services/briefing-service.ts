import { and, asc, count, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import {
  deliverySources,
  deployments,
  projects,
  pullRequestRiskAssessments,
  pullRequests,
} from '@lupin/db';
import { composeBriefing, type BriefingDecision, type BriefingInput } from '@lupin/reporting';
import { changeRiskRank, type Briefing, type ChangeRiskLevel } from '@lupin/shared-contracts';
import { inChunksOf, withinBound } from './bounded-list.js';
import { loadCockpitDigest } from './cockpit-digest.js';
import type { CockpitOptions } from './cockpit-service.js';
import { projectRow } from './health-findings.js';
import { projectPace } from './pace-service.js';
import { repositoryPhases } from './phase-service.js';

/**
 * The briefing's counts, read for one repository or summed across the portfolio, and handed to
 * the pure `composeBriefing`. Every read starts from `workspace_id`.
 */
export type BriefingOptions = CockpitOptions & { now?: () => Date };

export const BRIEFING_DEFAULT_DAYS = 7;
const MERGE_LIMIT = 5000;
const PORTFOLIO_LIMIT = 50;
/** Values per `inArray` statement. */
const IN_ARRAY_CHUNK = 500;
/** `DeliverySourceSchema.productionEnvironments` accepts at most 20. */
const MAX_PRODUCTION_ENVIRONMENTS = 20;
const DAY = 86_400_000;

type Merged = NonNullable<BriefingInput['merged']>;

const isAi = (attribution: string) =>
  attribution === 'agent-authored' || attribution === 'ai-assisted';
const isHigh = (level: string) =>
  changeRiskRank(level as ChangeRiskLevel) >= changeRiskRank('high');

/** Whether anything has ever read this project's pull requests. */
async function synced(options: BriefingOptions, projectId: string): Promise<boolean> {
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
  if (source?.enabled === true) return true;
  const [any] = await options.db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(
      and(eq(pullRequests.workspaceId, options.workspaceId), eq(pullRequests.projectId, projectId)),
    )
    .limit(1);
  return any !== undefined;
}

/** One chunk's assessments, newest first. */
function assessmentsFor(options: BriefingOptions, projectId: string, numbers: readonly number[]) {
  return options.db
    .select({
      number: pullRequestRiskAssessments.prNumber,
      level: pullRequestRiskAssessments.level,
      score: pullRequestRiskAssessments.score,
      headSha: pullRequestRiskAssessments.headSha,
      factors: pullRequestRiskAssessments.factors,
    })
    .from(pullRequestRiskAssessments)
    .where(
      and(
        eq(pullRequestRiskAssessments.workspaceId, options.workspaceId),
        eq(pullRequestRiskAssessments.projectId, projectId),
        inArray(pullRequestRiskAssessments.prNumber, withinBound(numbers, IN_ARRAY_CHUNK)),
      ),
    )
    .orderBy(desc(pullRequestRiskAssessments.assessedAt), desc(pullRequestRiskAssessments.id));
}

/** pr number → its latest assessment's level and whether it found tampering. */
async function latestAssessments(
  options: BriefingOptions,
  projectId: string,
  numbers: readonly number[],
) {
  const latest = new Map<
    number,
    { level: string; score: number; headSha: string; tampered: boolean }
  >();
  if (numbers.length === 0) return latest;
  // Up to MERGE_LIMIT numbers, so one statement per chunk. The chunks are disjoint, so
  // each chunk's newest-first order is enough to find every number's latest assessment.
  const rows = [];
  for (const chunk of inChunksOf(numbers, IN_ARRAY_CHUNK)) {
    rows.push(...(await assessmentsFor(options, projectId, chunk)));
  }
  for (const row of rows) {
    if (latest.has(row.number)) continue;
    latest.set(row.number, {
      level: row.level,
      score: row.score,
      headSha: row.headSha,
      tampered: row.factors.some(
        (factor) => factor.id === 'test-tampering' && factor.kind === 'risk',
      ),
    });
  }
  return latest;
}

async function mergedSince(
  options: BriefingOptions,
  projectId: string,
  since: Date,
): Promise<Merged> {
  const rows = await options.db
    .select({
      number: pullRequests.number,
      attribution: pullRequests.attribution,
      humanApprovalCount: pullRequests.humanApprovalCount,
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
    .limit(MERGE_LIMIT);
  const assessed = await latestAssessments(
    options,
    projectId,
    rows.map((row) => row.number),
  );
  const ai = rows.filter((row) => isAi(row.attribution));
  return {
    total: rows.length,
    ai: ai.length,
    unreviewedAi: ai.filter((row) => row.humanApprovalCount === 0).length,
    highRisk: rows.filter((row) => isHigh(assessed.get(row.number)?.level ?? 'low')).length,
    tampered: rows.filter((row) => assessed.get(row.number)?.tampered === true).length,
  };
}

async function deploymentsSince(
  options: BriefingOptions,
  projectId: string,
  since: Date,
): Promise<number> {
  const [source] = await options.db
    .select({ environments: deliverySources.productionEnvironments })
    .from(deliverySources)
    .where(
      and(
        eq(deliverySources.workspaceId, options.workspaceId),
        eq(deliverySources.projectId, projectId),
      ),
    )
    .limit(1);
  const environments = source?.environments ?? ['production'];
  const [row] = await options.db
    .select({ total: count() })
    .from(deployments)
    .where(
      and(
        eq(deployments.workspaceId, options.workspaceId),
        eq(deployments.projectId, projectId),
        eq(deployments.status, 'success'),
        inArray(deployments.environment, withinBound(environments, MAX_PRODUCTION_ENVIRONMENTS)),
        gte(deployments.createdAt, since),
      ),
    );
  return row?.total ?? 0;
}

/** Open changes assessed high or critical at their current head, worst first. */
export async function openDecisions(
  options: BriefingOptions,
  project: { id: string; name: string },
): Promise<BriefingDecision[]> {
  const open = await options.db
    .select({
      number: pullRequests.number,
      title: pullRequests.title,
      headSha: pullRequests.headSha,
    })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.workspaceId, options.workspaceId),
        eq(pullRequests.projectId, project.id),
        eq(pullRequests.state, 'open'),
        eq(pullRequests.draft, false),
      ),
    )
    .limit(MERGE_LIMIT);
  const assessed = await latestAssessments(
    options,
    project.id,
    open.map((row) => row.number),
  );
  return open
    .flatMap((row) => {
      const risk = assessed.get(row.number);
      const current = risk !== undefined && row.headSha?.toLowerCase() === risk.headSha;
      return current && isHigh(risk.level)
        ? [
            {
              projectId: project.id,
              projectName: project.name,
              number: row.number,
              title: row.title,
              level: risk.level as ChangeRiskLevel,
              score: risk.score,
            },
          ]
        : [];
    })
    .sort((a, b) => b.score - a.score || a.number - b.number);
}

async function paceOver(options: BriefingOptions, projectId: string, days: number) {
  const report = await projectPace(options, projectId, Math.max(1, Math.ceil(days / 7)));
  if (report.status === 'not_configured') return null;
  const changedLines = report.weeks.reduce((sum, week) => sum + week.changedLines, 0);
  const known = report.weeks.every((week) => week.testsAdded !== null);
  const added = report.weeks.reduce((sum, week) => sum + (week.testsAdded ?? 0), 0);
  return {
    changedLines,
    testsPerKloc:
      !known || changedLines === 0 ? null : Math.round((added / changedLines) * 10_000) / 10,
    debt: report.debt.uncoveredLines,
    unmeasured: report.debt.unmeasuredLines,
  };
}

async function qualityOf(options: BriefingOptions, projectId: string | null) {
  const digest = await loadCockpitDigest(options, undefined, projectId);
  return digest === null ? null : { headline: digest.cockpit.headline, tone: digest.cockpit.tone };
}

interface ProjectReading {
  merged: Merged | null;
  deployments: number | null;
  pace: BriefingInput['pace'];
  bottleneck: BriefingInput['bottlenecks'][number] | null;
  decisions: BriefingDecision[];
}

async function readProject(
  options: BriefingOptions,
  project: { id: string; name: string },
  since: Date,
  days: number,
): Promise<ProjectReading> {
  const isSynced = await synced(options, project.id);
  const [merged, deployed, pace, phases, decisions] = await Promise.all([
    isSynced ? mergedSince(options, project.id, since) : Promise.resolve(null),
    deploymentsSince(options, project.id, since),
    paceOver(options, project.id, days),
    repositoryPhases(options, project.id, days),
    openDecisions(options, project),
  ]);
  return {
    merged,
    deployments: deployed,
    pace,
    bottleneck:
      phases.bottleneck === null
        ? null
        : {
            projectId: project.id,
            projectName: project.name,
            sentence: phases.bottleneck.sentence,
          },
    decisions,
  };
}

const clampDays = (days: number) => Math.min(366, Math.max(1, Math.floor(days)));

export async function repositoryBriefing(
  options: BriefingOptions,
  projectId: string,
  days = BRIEFING_DEFAULT_DAYS,
): Promise<Briefing> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const window = clampDays(days);
  const read = await readProject(options, project, new Date(now.getTime() - window * DAY), window);
  return composeBriefing({
    scope: { kind: 'repository', projectId: project.id, name: project.name },
    now,
    windowDays: window,
    merged: read.merged,
    deployments: read.deployments,
    pace: read.pace,
    bottlenecks: read.bottleneck === null ? [] : [read.bottleneck],
    quality: await qualityOf(options, project.id),
    decisions: read.decisions,
  });
}

function sumMerged(readings: readonly ProjectReading[]): Merged | null {
  const known = readings.flatMap((reading) => (reading.merged === null ? [] : [reading.merged]));
  if (known.length === 0) return null;
  return known.reduce((sum, merged) => ({
    total: sum.total + merged.total,
    ai: sum.ai + merged.ai,
    highRisk: sum.highRisk + merged.highRisk,
    unreviewedAi: sum.unreviewedAi + merged.unreviewedAi,
    tampered: sum.tampered + merged.tampered,
  }));
}

function sumPace(readings: readonly ProjectReading[]): BriefingInput['pace'] {
  const known = readings.flatMap((reading) => (reading.pace === null ? [] : [reading.pace]));
  if (known.length === 0) return null;
  const changedLines = known.reduce((sum, pace) => sum + pace.changedLines, 0);
  const allTests = known.every((pace) => pace.testsPerKloc !== null);
  const added = known.reduce(
    (sum, pace) => sum + ((pace.testsPerKloc ?? 0) * pace.changedLines) / 1000,
    0,
  );
  return {
    changedLines,
    testsPerKloc:
      !allTests || changedLines === 0 ? null : Math.round((added / changedLines) * 10_000) / 10,
    debt: known.reduce((sum, pace) => sum + pace.debt, 0),
    unmeasured: known.reduce((sum, pace) => sum + pace.unmeasured, 0),
  };
}

/** The workspace's briefing: every repository's counts summed, every bottleneck and decision. */
export async function portfolioBriefing(
  options: BriefingOptions,
  days = BRIEFING_DEFAULT_DAYS,
): Promise<Briefing> {
  const now = options.now?.() ?? new Date();
  const window = clampDays(days);
  const since = new Date(now.getTime() - window * DAY);
  const all = await options.db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId))
    .orderBy(asc(projects.name))
    .limit(PORTFOLIO_LIMIT);
  const readings: ProjectReading[] = [];
  for (const project of all) readings.push(await readProject(options, project, since, window));
  return composeBriefing({
    scope: { kind: 'portfolio', projects: all.length },
    now,
    windowDays: window,
    merged: sumMerged(readings),
    deployments: readings.reduce((sum, reading) => sum + (reading.deployments ?? 0), 0),
    pace: sumPace(readings),
    bottlenecks: readings.flatMap((reading) =>
      reading.bottleneck === null ? [] : [reading.bottleneck],
    ),
    quality: all.length === 0 ? null : await qualityOf(options, null),
    decisions: readings
      .flatMap((reading) => reading.decisions)
      .sort((a, b) => b.score - a.score || a.number - b.number),
  });
}
