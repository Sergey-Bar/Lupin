import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { pullRequestRiskAssessments, pullRequests, testFailureCorrelations } from '@lupin/db';
import { assessChangeRisk, blastRadius, riskBlocks, type ChangeRiskInput } from '@lupin/reporting';
import {
  BlastRadiusSummarySchema,
  ChangeRiskSchema,
  RISK_HISTORY_LIMIT,
  type AiAttribution,
  type BlastRadiusSummary,
  type ChangeRiskPolicyBlock,
  type PullRequestRisk,
  type PullRequestRiskHistory,
} from '@lupin/shared-contracts';
import type { CommitTests } from './commit-tests.js';
import { tamperForRisk, type DiffGuardOptions } from './diff-guard-service.js';
import { projectRow, type ProjectRow } from './health-findings.js';
import {
  healthPolicyOf,
  ownerRules,
  type GateResult,
  type RepoHealthOptions,
} from './repo-health-service.js';

/**
 * A pull request's change risk at one head: the model's inputs gathered from what this install
 * already holds, the assessment stored, and the history read back.
 *
 * Every input is read, not inferred. The synced pull request gives authorship, size, approvals
 * and the changed paths; the gate gives diff coverage, new findings and the commit's tests;
 * CODEOWNERS and the failure correlations give the blast radius; `lupin diff-guard` gives the
 * tampering. Whatever is absent stays absent — `null` into the model — so it is reported as
 * missing evidence rather than read as safe.
 */

export type ChangeRiskOptions = DiffGuardOptions &
  Pick<RepoHealthOptions, 'readRepositoryFile'> & {
    /** Assessments kept per project. Default {@link RISK_ASSESSMENT_RETENTION}. */
    retention?: number;
  };

/** Assessments kept per project; the least recently assessed go first. */
export const RISK_ASSESSMENT_RETENTION = 5000;

/** What the gate measured on the head commit, in the model's own units. */
export interface RiskFacts {
  pullRequest: number;
  commit: string;
  branch: string;
  /** Percent, 0–100; `null` when not measured. */
  diffCoverage: number | null;
  /** `null` when no security scan was read for the branch. */
  findings: { high: number; critical: number } | null;
  tests: { runId: string; total: number; failed: number; unexcusedFlaky: number } | null;
  evalRegressions: number | null;
  /** The gate's own classification, fresher than a stored one; `null` when it made none. */
  attribution: { attribution: AiAttribution; agent: string | null } | null;
}

/**
 * The gate's result read as risk facts. A security dimension that was not measured means no
 * scan was read, so its findings are `null` — "no findings" would be a claim nothing made.
 * Report errors outside a test count as failures: a broken run is not a passing one.
 */
export function riskFactsOf(
  result: GateResult,
  tests: CommitTests | null,
  commit: string,
  pullRequest: number,
): RiskFacts {
  const scanned = result.grade.dimensions.some(
    (entry) => entry.dimension === 'security' && entry.measured,
  );
  const ratio = result.diffCoverage?.ratio ?? null;
  return {
    pullRequest,
    commit,
    branch: result.branch,
    diffCoverage: ratio === null ? null : Math.round(ratio * 10_000) / 100,
    findings: scanned
      ? {
          high: result.added.filter((finding) => finding.severity === 'high').length,
          critical: result.added.filter((finding) => finding.severity === 'critical').length,
        }
      : null,
    tests:
      tests === null
        ? null
        : {
            runId: tests.runId,
            total: tests.total,
            failed: tests.failures.length + tests.reportErrors,
            unexcusedFlaky: tests.flakyUnquarantined.length,
          },
    evalRegressions:
      result.evals === null
        ? null
        : result.evals.suites.filter((suite) => suite.verdict === 'fail').length,
    attribution:
      result.aiGovernance === null
        ? null
        : { attribution: result.aiGovernance.attribution, agent: result.aiGovernance.agent },
  };
}

const prScope = (options: ChangeRiskOptions, projectId: string) =>
  and(eq(pullRequests.workspaceId, options.workspaceId), eq(pullRequests.projectId, projectId));
const assessmentScope = (options: ChangeRiskOptions, projectId: string) =>
  and(
    eq(pullRequestRiskAssessments.workspaceId, options.workspaceId),
    eq(pullRequestRiskAssessments.projectId, projectId),
  );

async function syncedPullRequest(options: ChangeRiskOptions, projectId: string, number: number) {
  const [row] = await options.db
    .select()
    .from(pullRequests)
    .where(and(prScope(options, projectId), eq(pullRequests.number, number)))
    .orderBy(desc(pullRequests.syncedAt))
    .limit(1);
  return row;
}

/** The changed files' failure correlations, in this workspace only. */
async function correlationsFor(options: ChangeRiskOptions, paths: readonly string[]) {
  if (paths.length === 0) return [];
  return options.db
    .select({
      testStableId: testFailureCorrelations.testStableId,
      sourceFilePath: testFailureCorrelations.sourceFilePath,
      failureCount: testFailureCorrelations.failureCount,
    })
    .from(testFailureCorrelations)
    .where(
      and(
        eq(testFailureCorrelations.workspaceId, options.workspaceId),
        inArray(testFailureCorrelations.sourceFilePath, [...paths]),
      ),
    );
}

async function radiusOf(
  options: ChangeRiskOptions,
  project: ProjectRow,
  row: NonNullable<Awaited<ReturnType<typeof syncedPullRequest>>> | undefined,
) {
  if (row === undefined) return null;
  const { forRisk, ...summary } = blastRadius({
    changedPaths: row.changedPaths,
    changedFiles: row.changedFiles,
    codeowners: await ownerRules(options, project),
    correlations: await correlationsFor(options, row.changedPaths),
  });
  return { forRisk, summary };
}

function policyOf(project: ProjectRow): ChangeRiskPolicyBlock {
  return healthPolicyOf(project)?.risk ?? {};
}

/**
 * The reason the gate fails on this risk, or `null` when the policy does not block it. Unset
 * `blockAt` is report-only: the risk is in the comment and the response, and the verdict is
 * the gate's own.
 */
export function riskGateReason(
  assessed: PullRequestRisk | null,
  policy: ChangeRiskPolicyBlock,
): string | null {
  if (assessed === null) return null;
  const { level, score } = assessed.risk;
  if (!riskBlocks(level, policy)) return null;
  return level === 'unknown'
    ? `Change risk is unknown (${assessed.risk.missing.join(', ')} not measured), and the policy blocks an unknown risk.`
    : `Change risk is ${level} (${String(score)} points); the policy blocks at ${String(policy.blockAt)}.`;
}

/** The project's change-risk policy block, `{}` when it sets none. */
export async function riskPolicyFor(
  options: ChangeRiskOptions,
  projectId: string,
): Promise<ChangeRiskPolicyBlock> {
  return policyOf(await projectRow(options, projectId));
}

/** Assess the pull request at `facts.commit`, store it, and return it. */
export async function assessPullRequestRisk(
  options: ChangeRiskOptions,
  projectId: string,
  facts: RiskFacts,
): Promise<PullRequestRisk> {
  const project = await projectRow(options, projectId);
  const row = await syncedPullRequest(options, project.id, facts.pullRequest);
  const radius = await radiusOf(options, project, row);
  const head = facts.commit.toLowerCase();
  const input: ChangeRiskInput = {
    attribution:
      facts.attribution?.attribution ??
      (row?.attribution as AiAttribution | undefined) ??
      'unknown',
    agent: facts.attribution === null ? (row?.aiAgent ?? null) : facts.attribution.agent,
    additions: row?.additions ?? 0,
    deletions: row?.deletions ?? 0,
    testsTouched: row?.testsTouched ?? false,
    humanApprovals: row?.humanApprovalCount ?? 0,
    diffCoverage: facts.diffCoverage,
    findings: facts.findings,
    tests:
      facts.tests === null
        ? null
        : {
            total: facts.tests.total,
            failed: facts.tests.failed,
            unexcusedFlaky: facts.tests.unexcusedFlaky,
          },
    evalRegressions: facts.evalRegressions,
    blastRadius: radius?.forRisk ?? null,
    tampering: await tamperForRisk(options, project.id, head),
    // The SDLC phase model fills this in its own wave; nothing is claimed skipped before it.
    skippedPhases: [],
    evidence: {
      attribution: `pull-request:${String(facts.pullRequest)}`,
      'diff-coverage': `commit:${head}`,
      findings: `branch:${facts.branch}`,
      tampering: `diff-guard:${head}`,
      ...(facts.tests === null ? {} : { tests: `run:${facts.tests.runId}` }),
    },
  };
  const policy = policyOf(project);
  const risk = assessChangeRisk(
    input,
    policy.require === undefined ? {} : { require: policy.require },
  );
  const assessedAt = options.now?.() ?? new Date();
  const values = {
    level: risk.level,
    score: risk.score,
    version: risk.version,
    factors: risk.factors,
    missing: risk.missing,
    blastRadius: radius?.summary ?? null,
    assessedAt,
  };
  await options.db
    .insert(pullRequestRiskAssessments)
    .values({
      workspaceId: options.workspaceId,
      projectId: project.id,
      prNumber: facts.pullRequest,
      headSha: head,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        pullRequestRiskAssessments.workspaceId,
        pullRequestRiskAssessments.projectId,
        pullRequestRiskAssessments.prNumber,
        pullRequestRiskAssessments.headSha,
      ],
      set: values,
    });
  await prune(options, project.id);
  return {
    pullRequest: facts.pullRequest,
    headSha: head,
    risk,
    blastRadius: radius?.summary ?? null,
    assessedAt: assessedAt.toISOString(),
  };
}

async function prune(options: ChangeRiskOptions, projectId: string): Promise<void> {
  const scope = assessmentScope(options, projectId);
  const keep = options.db
    .select({ id: pullRequestRiskAssessments.id })
    .from(pullRequestRiskAssessments)
    .where(scope)
    .orderBy(desc(pullRequestRiskAssessments.assessedAt), desc(pullRequestRiskAssessments.id))
    .limit(options.retention ?? RISK_ASSESSMENT_RETENTION);
  await options.db
    .delete(pullRequestRiskAssessments)
    .where(and(scope, notInArray(pullRequestRiskAssessments.id, keep)));
}

type AssessmentRow = typeof pullRequestRiskAssessments.$inferSelect;

/**
 * A stored row read back as the contract describes it. A row the current contract cannot read —
 * written by another points table — is left out rather than shown wrong.
 */
function assessmentOf(row: AssessmentRow): PullRequestRisk | null {
  const risk = ChangeRiskSchema.safeParse({
    level: row.level,
    score: row.score,
    version: row.version,
    factors: row.factors,
    missing: row.missing,
  });
  if (!risk.success) return null;
  const radius =
    row.blastRadius === null ? null : BlastRadiusSummarySchema.safeParse(row.blastRadius);
  return {
    pullRequest: row.prNumber,
    headSha: row.headSha,
    risk: risk.data,
    blastRadius: radius?.success === true ? (radius.data as BlastRadiusSummary) : null,
    assessedAt: row.assessedAt.toISOString(),
  };
}

/** The pull request's latest assessment and its history across heads, newest first. */
export async function pullRequestRisk(
  options: ChangeRiskOptions,
  projectId: string,
  pullRequest: number,
): Promise<PullRequestRiskHistory> {
  const project = await projectRow(options, projectId);
  const rows = await options.db
    .select()
    .from(pullRequestRiskAssessments)
    .where(
      and(
        assessmentScope(options, project.id),
        eq(pullRequestRiskAssessments.prNumber, pullRequest),
      ),
    )
    .orderBy(desc(pullRequestRiskAssessments.assessedAt), desc(pullRequestRiskAssessments.id))
    .limit(RISK_HISTORY_LIMIT);
  const history = rows.flatMap((row) => assessmentOf(row) ?? []);
  return { pullRequest, latest: history[0] ?? null, history };
}
