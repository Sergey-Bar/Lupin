import { and, asc, desc, eq, max, ne } from 'drizzle-orm';
import { deliverySources, healthSnapshots, projects, pullRequests, runs } from '@lupin/db';
import { shapeReading, worstReading, type ShapeInputSignal } from '@lupin/reporting';
import {
  HealthGradeSchema,
  type ChangeRiskLevel,
  type PortfolioShape,
  type ScopedShape,
  type Shape,
  type ShapeReading,
} from '@lupin/shared-contracts';
import { openDecisions } from './briefing-service.js';
import { pullRequestRisk } from './change-risk-service.js';
import type { CockpitOptions } from './cockpit-service.js';
import { branchFor, projectRow } from './health-findings.js';
import { pullRequestPhases, repositoryPhases } from './phase-service.js';

/**
 * Good shape or bad shape, at three levels, each read from signals this install already holds:
 *
 * - **a pull request:** its change risk at its latest head, and its SDLC phases;
 * - **a repository:** its health grade, its last finished run, its phases over 30 days, and its
 *   open changes at high risk or above;
 * - **the portfolio:** every repository's signals together, and each repository worst first.
 *
 * Each signal carries the time it was measured, so `shapeReading` can say when the evidence is
 * stale. Every read starts from `workspace_id`.
 */
export type ShapeOptions = CockpitOptions & { now?: () => Date };

const PORTFOLIO_LIMIT = 50;
const RANK: Readonly<Record<Shape, number>> = { bad: 0, caution: 1, unknown: 2, good: 3 };

const GRADE_SHAPE: Readonly<Record<string, Shape>> = {
  A: 'good',
  B: 'good',
  C: 'caution',
  D: 'bad',
  F: 'bad',
};

const RISK_SHAPE: Readonly<Record<ChangeRiskLevel, Shape>> = {
  low: 'good',
  medium: 'caution',
  unknown: 'unknown',
  high: 'bad',
  critical: 'bad',
};

type Project = { id: string; name: string; defaultBranch: string | null };

async function gradeSignal(options: ShapeOptions, project: Project): Promise<ShapeInputSignal> {
  const [snapshot] = await options.db
    .select({ takenAt: healthSnapshots.takenAt, grade: healthSnapshots.grade })
    .from(healthSnapshots)
    .where(
      and(
        eq(healthSnapshots.workspaceId, options.workspaceId),
        eq(healthSnapshots.projectId, project.id),
        eq(healthSnapshots.branch, branchFor(project)),
      ),
    )
    .orderBy(desc(healthSnapshots.takenAt))
    .limit(1);
  const grade = snapshot === undefined ? null : HealthGradeSchema.safeParse(snapshot.grade);
  if (snapshot === undefined || grade?.success !== true || grade.data.letter === null) {
    return {
      id: 'grade',
      shape: 'unknown',
      at: null,
      reason:
        grade?.success === true && grade.data.incompleteReason !== null
          ? `Grade incomplete: ${grade.data.incompleteReason}`
          : 'No health report has been received.',
    };
  }
  const letter = grade.data.letter;
  return {
    id: 'grade',
    shape: GRADE_SHAPE[letter] ?? 'unknown',
    at: snapshot.takenAt,
    reason: `Grade ${letter}${grade.data.limiter === null ? '' : `, limited by ${grade.data.limiter}`}.`,
  };
}

async function testsSignal(options: ShapeOptions, projectId: string): Promise<ShapeInputSignal> {
  const [run] = await options.db
    .select({
      status: runs.status,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      completedAt: runs.completedAt,
      failed: runs.failed,
      total: runs.total,
    })
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, options.workspaceId),
        eq(runs.projectId, projectId),
        ne(runs.status, 'running'),
      ),
    )
    .orderBy(desc(runs.startedAt))
    .limit(1);
  if (run === undefined) {
    return { id: 'tests', shape: 'unknown', at: null, reason: 'No finished run is recorded.' };
  }
  const at = run.completedAt ?? run.finishedAt ?? run.startedAt;
  if (run.status === 'passed') {
    return { id: 'tests', shape: 'good', at, reason: 'The last run passed.' };
  }
  if (run.status === 'failed') {
    return {
      id: 'tests',
      shape: 'bad',
      at,
      reason: `The last run failed: ${String(run.failed)} of ${String(run.total)} tests.`,
    };
  }
  return { id: 'tests', shape: 'caution', at, reason: 'The last run was interrupted.' };
}

/** When the delivery data was last read: the sync's own time, else the newest synced row. */
async function syncedAt(options: ShapeOptions, projectId: string): Promise<Date | null> {
  const [source] = await options.db
    .select({ at: deliverySources.lastSyncedAt })
    .from(deliverySources)
    .where(
      and(
        eq(deliverySources.workspaceId, options.workspaceId),
        eq(deliverySources.projectId, projectId),
      ),
    )
    .limit(1);
  if (source?.at !== null && source?.at !== undefined) return source.at;
  const [row] = await options.db
    .select({ at: max(pullRequests.syncedAt) })
    .from(pullRequests)
    .where(
      and(eq(pullRequests.workspaceId, options.workspaceId), eq(pullRequests.projectId, projectId)),
    );
  return row?.at ?? null;
}

const NOT_SYNCED = 'No pull request has been read: turn on delivery sync.';

function phaseSignalOf(
  phases: Awaited<ReturnType<typeof repositoryPhases>>,
  at: Date,
): ShapeInputSignal {
  const measured = phases.phases.filter((entry) => entry.shape !== 'unknown');
  const worst = [...measured].sort((a, b) => RANK[a.shape] - RANK[b.shape])[0];
  return worst === undefined
    ? { id: 'phases', shape: 'unknown', at: null, reason: 'No phase was measured.' }
    : { id: 'phases', shape: worst.shape, at, reason: phases.bottleneck?.sentence ?? worst.reason };
}

const changes = (count: number) =>
  `${String(count)} open ${count === 1 ? 'change is' : 'changes are'}`;

function riskSignalOf(
  decisions: Awaited<ReturnType<typeof openDecisions>>,
  at: Date,
): ShapeInputSignal {
  if (decisions.length === 0) {
    return { id: 'risk', shape: 'good', at, reason: 'No open change is at high risk or above.' };
  }
  const critical = decisions.filter((entry) => entry.level === 'critical').length;
  return critical > 0
    ? { id: 'risk', shape: 'bad', at, reason: `${changes(critical)} at critical risk.` }
    : { id: 'risk', shape: 'caution', at, reason: `${changes(decisions.length)} at high risk.` };
}

async function deliverySignals(
  options: ShapeOptions,
  project: Project,
): Promise<[ShapeInputSignal, ShapeInputSignal]> {
  const [phases, decisions, at] = await Promise.all([
    repositoryPhases(options, project.id),
    openDecisions(options, project),
    syncedAt(options, project.id),
  ]);
  if (!phases.configured || at === null) {
    return [
      { id: 'phases', shape: 'unknown', at: null, reason: NOT_SYNCED },
      { id: 'risk', shape: 'unknown', at: null, reason: NOT_SYNCED },
    ];
  }
  return [phaseSignalOf(phases, at), riskSignalOf(decisions, at)];
}

async function readRepository(options: ShapeOptions, project: Project): Promise<ShapeReading> {
  const [grade, tests, [phases, risk]] = await Promise.all([
    gradeSignal(options, project),
    testsSignal(options, project.id),
    deliverySignals(options, project),
  ]);
  return shapeReading([grade, tests, phases, risk], options.now?.() ?? new Date());
}

export async function repositoryShape(
  options: ShapeOptions,
  projectId: string,
): Promise<ScopedShape> {
  const project = await projectRow(options, projectId);
  const reading = await readRepository(options, project);
  return { ...reading, projectId: project.id, name: project.name, pullRequest: null };
}

/** One pull request's shape: its risk at its latest head, and its phases; `null` unsynced. */
export async function pullRequestShape(
  options: ShapeOptions,
  projectId: string,
  number: number,
): Promise<ScopedShape | null> {
  const project = await projectRow(options, projectId);
  const [strip, risk, at] = await Promise.all([
    pullRequestPhases(options, project.id, number),
    pullRequestRisk(options, project.id, number),
    syncedAt(options, project.id),
  ]);
  if (strip === null) return null;
  const latest = risk.latest;
  const riskSignal: ShapeInputSignal =
    latest === null
      ? { id: 'risk', shape: 'unknown', at: null, reason: 'The gate has not assessed it yet.' }
      : {
          id: 'risk',
          shape: RISK_SHAPE[latest.risk.level],
          at: new Date(latest.assessedAt),
          reason: `Change risk ${latest.risk.level}, ${String(latest.risk.score)} points.`,
        };
  const skipped = strip.skipped.length;
  const phaseSignal: ShapeInputSignal = {
    id: 'phases',
    shape: strip.shape,
    at,
    reason:
      skipped > 0
        ? `Skipped ${strip.skipped.join(', ')}.`
        : (strip.phases.find((step) => step.shape === strip.shape)?.reason ?? 'Phases read.'),
  };
  const reading = shapeReading([riskSignal, phaseSignal], options.now?.() ?? new Date());
  return { ...reading, projectId: project.id, name: project.name, pullRequest: number };
}

/** The workspace's shape, and each repository's, worst first. */
export async function portfolioShape(options: ShapeOptions): Promise<PortfolioShape> {
  const now = options.now?.() ?? new Date();
  const all = await options.db
    .select({ id: projects.id, name: projects.name, defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId))
    .orderBy(asc(projects.name))
    .limit(PORTFOLIO_LIMIT + 1);
  const read = all.slice(0, PORTFOLIO_LIMIT);
  const shapes: ScopedShape[] = [];
  for (const project of read) {
    const reading = await readRepository(options, project);
    shapes.push({ ...reading, projectId: project.id, name: project.name, pullRequest: null });
  }
  shapes.sort((a, b) => RANK[a.shape] - RANK[b.shape] || a.name.localeCompare(b.name));
  return {
    evaluatedAt: now.toISOString(),
    overall: worstReading(shapes, now),
    projects: shapes,
    total: read.length,
    truncated: all.length > PORTFOLIO_LIMIT,
  };
}
