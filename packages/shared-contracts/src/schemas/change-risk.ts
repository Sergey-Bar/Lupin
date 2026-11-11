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
