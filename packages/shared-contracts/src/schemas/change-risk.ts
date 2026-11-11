import { z } from 'zod/v4';

/**
 * Change risk: how much a pull request should worry the person who has to let it in.
 *
 * Every point is a stated factor with its own sentence and, where one exists, the evidence it
 * was read from, so the score can be added up by hand. A factor of kind `missing` is evidence
 * that was not there: it carries no points, and while it names *required* evidence the level
 * cannot be `low` — "not measured" is never "safe".
 */

export const CHANGE_RISK_LEVELS = ['low', 'medium', 'unknown', 'high', 'critical'] as const;
export const ChangeRiskLevelSchema = z.enum(CHANGE_RISK_LEVELS);
export type ChangeRiskLevel = z.infer<typeof ChangeRiskLevelSchema>;

/**
 * The order a reader worries in. `unknown` sits above `medium` — a change nobody measured is
 * not one to wave through — and below `high`, which is a measured reason to stop.
 */
const RANK: Readonly<Record<ChangeRiskLevel, number>> = {
  low: 0,
  medium: 1,
  unknown: 2,
  high: 3,
  critical: 4,
};

export function changeRiskRank(level: ChangeRiskLevel): number {
  return RANK[level];
}

/**
 * The ways a change can weaken the tests that judge it, as `lupin diff-guard` reports them.
 * One vocabulary for the CLI that detects them, the API that stores them and the factor that
 * scores them.
 */
export const TEST_TAMPER_KINDS = [
  'test-deleted',
  'skip-added',
  'assertion-removed',
  'assertion-loosened',
  'empty-catch',
  'snapshot-bulk-update',
  'threshold-lowered',
  'ci-made-non-failing',
  'retry-added',
] as const;
export const TestTamperKindSchema = z.enum(TEST_TAMPER_KINDS);
export type TestTamperKind = z.infer<typeof TestTamperKindSchema>;

/** Findings `lupin diff-guard` keeps in one report; every finding is still counted. */
export const MAX_DIFF_GUARD_FINDINGS = 200;

/**
 * One way a change weakens a test: a kind, a path, a line and its side of the diff. Never the
 * text of the line — the guard runs in CI precisely so that no source leaves the job.
 */
export const TestTamperFindingSchema = z.strictObject({
  kind: TestTamperKindSchema,
  path: z.string().min(1).max(500),
  line: z.number().int().min(0).nullable(),
  side: z.enum(['base', 'head']),
});
export type TestTamperFinding = z.infer<typeof TestTamperFindingSchema>;

export const DiffGuardReportSchema = z.strictObject({
  version: z.string().min(1).max(50),
  findings: z.array(TestTamperFindingSchema).max(MAX_DIFF_GUARD_FINDINGS),
  counts: z.partialRecord(TestTamperKindSchema, z.number().int().min(0)),
  filesChecked: z.number().int().min(0),
  truncated: z.boolean(),
});
export type DiffGuardReport = z.infer<typeof DiffGuardReportSchema>;

/** What `lupin diff-guard` sends: the report, and the commit and base it was read against. */
export const DiffGuardUploadSchema = z.strictObject({
  commit: z.string().regex(/^[0-9a-f]{7,64}$/iu),
  base: z.string().min(1).max(255),
  branch: z.string().trim().min(1).max(255).optional(),
  pullRequest: z.number().int().min(1).optional(),
  report: DiffGuardReportSchema,
});
export type DiffGuardUpload = z.infer<typeof DiffGuardUploadSchema>;

/**
 * What the install holds for one commit. `none` says no job sent a report — test changes were
 * not checked — which is never the same as a report with no findings.
 */
export const DiffGuardStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('none'), commit: z.string().min(1) }),
  z.strictObject({
    state: z.literal('reported'),
    commit: z.string().min(1),
    base: z.string().min(1),
    branch: z.string().nullable(),
    pullRequest: z.number().int().min(1).nullable(),
    report: DiffGuardReportSchema,
    reportedAt: z.iso.datetime({ offset: true }),
  }),
]);
export type DiffGuardStatus = z.infer<typeof DiffGuardStatusSchema>;

/** The evidence an assessment can read. A policy names which of them are required. */
export const CHANGE_RISK_EVIDENCE = [
  'attribution',
  'tests',
  'diff-coverage',
  'findings',
  'tampering',
  'evals',
] as const;
export const ChangeRiskEvidenceSchema = z.enum(CHANGE_RISK_EVIDENCE);
export type ChangeRiskEvidence = z.infer<typeof ChangeRiskEvidenceSchema>;

export const CHANGE_RISK_FACTOR_IDS = [
  'ai-authorship',
  'size',
  'no-tests-touched',
  'diff-coverage',
  'new-findings',
  'failed-tests',
  'unexcused-flaky',
  'no-human-approval',
  'eval-regression',
  'blast-radius',
  'test-tampering',
  'skipped-phases',
  // The evidence that can be missing, named as itself.
  'attribution',
  'tests',
  'findings',
  'tampering',
  'evals',
] as const;
export const ChangeRiskFactorIdSchema = z.enum(CHANGE_RISK_FACTOR_IDS);
export type ChangeRiskFactorId = z.infer<typeof ChangeRiskFactorIdSchema>;

export const ChangeRiskFactorSchema = z
  .object({
    id: ChangeRiskFactorIdSchema,
    kind: z.enum(['risk', 'missing']),
    points: z.number().int().min(0),
    /** One plain sentence a reader can check. */
    detail: z.string().min(1).max(300),
    /** Where the factor was read from: a run id, a commit, a URL. `null` when nothing names it. */
    evidence: z.string().min(1).max(500).nullable(),
  })
  .refine((factor) => factor.kind === 'risk' || factor.points === 0, {
    message: 'missing evidence carries no points',
    path: ['points'],
  });
export type ChangeRiskFactor = z.infer<typeof ChangeRiskFactorSchema>;

export const ChangeRiskSchema = z
  .object({
    level: ChangeRiskLevelSchema,
    score: z.number().int().min(0),
    /** The points table the score was computed with. A different version is not comparable. */
    version: z.string().min(1),
    /** Risk factors first, by points; then the missing evidence. */
    factors: z.array(ChangeRiskFactorSchema),
    /** The *required* evidence that was not there. Non-empty means the level is never `low`. */
    missing: z.array(ChangeRiskEvidenceSchema),
  })
  .refine((risk) => risk.score === risk.factors.reduce((sum, factor) => sum + factor.points, 0), {
    message: 'the score is the sum of the factor points',
    path: ['score'],
  })
  .refine((risk) => risk.missing.length === 0 || risk.level !== 'low', {
    message: 'a change with required evidence missing is never low risk',
    path: ['level'],
  });
export type ChangeRisk = z.infer<typeof ChangeRiskSchema>;

/**
 * The project's change-risk policy (`lupin.config.json` → `health.risk`). Report-only unless
 * `blockAt` is set: installing Lupin never turns a team's pull requests red on day one.
 */
export const ChangeRiskPolicySchema = z.strictObject({
  /** The evidence without which a change is never `low`. Default: tests and diff coverage. */
  require: z.array(ChangeRiskEvidenceSchema).max(CHANGE_RISK_EVIDENCE.length).optional(),
  /** The level at which the gate fails. `null` or absent: reported, never blocking. */
  blockAt: z.enum(['high', 'critical']).nullable().optional(),
  /** Whether an `unknown` level fails a gate that blocks at all. Default `false`. */
  blockOnUnknown: z.boolean().optional(),
});
export type ChangeRiskPolicyBlock = z.infer<typeof ChangeRiskPolicySchema>;

/** What a change can break beyond its own lines. Teams are named; people are only counted. */
export const BlastRadiusSummarySchema = z.object({
  version: z.string().min(1),
  sensitiveAreas: z.array(
    z.object({
      area: z.string().min(1),
      count: z.number().int().min(1),
      paths: z.array(z.string()).max(5),
    }),
  ),
  teams: z.array(z.string()),
  individualOwners: z.number().int().min(0).nullable(),
  unownedPaths: z.number().int().min(0).nullable(),
  linkedTests: z.array(
    z.object({
      testStableId: z.string().min(1),
      failures: z.number().int().min(1),
      files: z.number().int().min(1),
    }),
  ),
  linkedTestsTotal: z.number().int().min(0),
  truncated: z.boolean(),
});
export type BlastRadiusSummary = z.infer<typeof BlastRadiusSummarySchema>;

/** One assessment of a pull request at one head commit. */
export const PullRequestRiskSchema = z.object({
  pullRequest: z.number().int().min(1),
  headSha: z.string().min(1),
  risk: ChangeRiskSchema,
  blastRadius: BlastRadiusSummarySchema.nullable(),
  assessedAt: z.iso.datetime({ offset: true }),
});
export type PullRequestRisk = z.infer<typeof PullRequestRiskSchema>;

/** `GET /api/v1/projects/:id/pull-requests/:number/risk`: the latest first, then earlier heads. */
export const PullRequestRiskHistorySchema = z.object({
  pullRequest: z.number().int().min(1),
  latest: PullRequestRiskSchema.nullable(),
  /** At most {@link RISK_HISTORY_LIMIT}, newest first, including the latest. */
  history: z.array(PullRequestRiskSchema),
});
export type PullRequestRiskHistory = z.infer<typeof PullRequestRiskHistorySchema>;

export const RISK_HISTORY_LIMIT = 20;
