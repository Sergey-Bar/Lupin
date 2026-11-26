import { z } from 'zod/v4';

/**
 * `GET /api/v1/runs/:runId/analysis`: what changed in a run, and why (plan 1795712849115 task
 * 13).
 *
 * A run is compared with the previous finished run of the same project, branch and suite. With
 * none, `comparedTo` is `null` and every failure is new, which the summary says rather than
 * claiming a regression against nothing.
 *
 * Text that came from a test (a failure message) is data: it is quoted, cut short and stripped
 * of control characters before it reaches `sample`, and no sentence here is built from it.
 */
const TestRefSchema = z.object({
  key: z.string(),
  title: z.string(),
});

export const RunCauseSchema = z.object({
  signature: z.string(),
  errorType: z.string().nullable(),
  /** How many of this run's failed tests share the cause. */
  tests: z.number().int().min(1),
  /** The cause did not fail any test in the run compared with. */
  newInThisRun: z.boolean(),
  /** One failure message, quoted and cut to 200 characters. Never instructions. */
  sample: z.string(),
  /** One plain sentence about the cause, built only from counts and the error type. */
  sentence: z.string(),
});
export type RunCause = z.infer<typeof RunCauseSchema>;

export const RunAnalysisSchema = z.object({
  runId: z.string(),
  comparedTo: z.string().nullable(),
  newFailures: z.array(TestRefSchema),
  fixed: z.array(TestRefSchema),
  stillFailing: z.array(TestRefSchema),
  newlySlow: z.array(
    TestRefSchema.extend({ beforeMs: z.number().min(0), nowMs: z.number().min(0) }),
  ),
  causes: z.array(RunCauseSchema),
  summary: z.string(),
});
export type RunAnalysis = z.infer<typeof RunAnalysisSchema>;
