import { z } from 'zod/v4';

/**
 * The cockpit: one payload that answers "is the product better or worse than it was, and why?"
 *
 * Nothing here is a score of its own. Every number is read from a stored reading (health and
 * scan snapshots, runs, pull requests, deployments) and compared with the reading before it.
 * Where there is nothing to compare, the payload says so with a status, never with a delta of 0.
 */

/** What the change is measured against. `release` is the last successful production deployment. */
export const COCKPIT_WINDOWS = ['7d', 'release'] as const;
export const CockpitWindowSchema = z.enum(COCKPIT_WINDOWS);
export type CockpitWindow = z.infer<typeof CockpitWindowSchema>;

/**
 * - `improved`, `worse`, `flat`: two comparable readings.
 * - `not_measured`: nothing was measured in the window. There is no change to show.
 * - `no_baseline`: measured now, nothing before to compare with.
 * - `formula_changed`: the readings were computed by different scoring formulas (or by an
 *   unversioned one), so the difference would be the formula's and not the product's.
 */
export const COCKPIT_STATUSES = [
  'improved',
  'worse',
  'flat',
  'not_measured',
  'no_baseline',
  'formula_changed',
] as const;
export const CockpitStatusSchema = z.enum(COCKPIT_STATUSES);
export type CockpitStatus = z.infer<typeof CockpitStatusSchema>;

export const COCKPIT_METRIC_IDS = [
  'security',
  'tests',
  'code-quality',
  'dependencies',
  'coverage',
  'flaky-tests',
  'run-pass-rate',
] as const;
export const CockpitMetricIdSchema = z.enum(COCKPIT_METRIC_IDS);
export type CockpitMetricId = z.infer<typeof CockpitMetricIdSchema>;

/**
 * What a metric moved because of.
 *
 * `candidate: true` means the link is a window, not a fact: the metric is recorded hourly, so
 * the runs that happened while it moved are offered, and none of them is named the cause.
 * `unknown` is said when no commit or run can be tied to the change.
 */
export const CockpitDriverSchema = z.object({
  kind: z.enum(['pull_request', 'run', 'commit', 'unknown']),
  /** A pull request number, a run id or a commit sha. `null` for `unknown`. */
  ref: z.string().min(1).nullable(),
  label: z.string().min(1),
  /** A GitHub commit or pull request address, when the project has a GitHub repository. */
  url: z.string().url().nullable(),
  candidate: z.boolean(),
  /** How far the metric moved at this step, in the metric's own unit. `null` when not a step. */
  change: z.number().nullable(),
  at: z.iso.datetime().nullable(),
});
export type CockpitDriver = z.infer<typeof CockpitDriverSchema>;

export const CockpitSeriesPointSchema = z.object({
  at: z.iso.datetime(),
  value: z.number(),
});
export type CockpitSeriesPoint = z.infer<typeof CockpitSeriesPointSchema>;

export const CockpitMetricSchema = z.object({
  id: CockpitMetricIdSchema,
  label: z.string().min(1),
  unit: z.enum(['score', 'percent', 'count']),
  /** `false` for a count of problems, where a smaller number is the better one. */
  higherIsBetter: z.boolean(),
  value: z.number().nullable(),
  baseline: z.number().nullable(),
  delta: z.number().nullable(),
  status: CockpitStatusSchema,
  /** At most 30 points, oldest first. */
  series: z.array(CockpitSeriesPointSchema).max(30).readonly(),
  /** At most 3, the largest steps first. Empty when the metric did not move. */
  drivers: z.array(CockpitDriverSchema).max(3).readonly(),
});
export type CockpitMetric = z.infer<typeof CockpitMetricSchema>;

export const CockpitOverallSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  letter: z.enum(['A+', 'A', 'B', 'C', 'D', 'F']).nullable(),
  baseline: z.number().min(0).max(100).nullable(),
  delta: z.number().nullable(),
  status: CockpitStatusSchema,
  drivers: z.array(CockpitDriverSchema).max(3).readonly(),
});
export type CockpitOverall = z.infer<typeof CockpitOverallSchema>;

/** Where the scoring formula changed inside the series, so a chart can break its line there. */
export const CockpitFormulaBreakSchema = z.object({
  at: z.iso.datetime(),
  from: z.number().int().min(0),
  to: z.number().int().min(1),
});
export type CockpitFormulaBreak = z.infer<typeof CockpitFormulaBreakSchema>;

/**
 * One week of pace against quality. Weeks run Monday 00:00 UTC to the next Monday, the same
 * weeks the AI-code share is bucketed into, and every one of the last twelve is present: a week
 * in which nothing merged is `merged: 0` with no share, never a gap a chart could read as a trend.
 */
export const CockpitPaceWeekSchema = z.object({
  /** The Monday the week starts, `YYYY-MM-DD` in UTC. */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The current week is still in progress, so its counts are not yet a week's. */
  partial: z.boolean(),
  /** Pull requests merged into the shown branch this week. */
  merged: z.number().int().min(0),
  /** Lines added plus lines deleted by those pull requests. */
  linesChanged: z.number().int().min(0),
  /** Of `merged`, those attributed agent-authored or AI-assisted. */
  aiAuthored: z.number().int().min(0),
  /** Of `merged`, those whose authorship could not be attributed: not counted as AI, not as human. */
  unattributed: z.number().int().min(0),
  /** `aiAuthored` as a percentage of `merged`; `null` when nothing merged. */
  aiShare: z.number().min(0).max(100).nullable(),
  /** The last overall health score recorded this week; `null` when none was. */
  score: z.number().min(0).max(100).nullable(),
  /** The formula that graded `score`, so a chart can break its line where it changed. */
  formulaVersion: z.number().int().min(0).nullable(),
});
export type CockpitPaceWeek = z.infer<typeof CockpitPaceWeekSchema>;

/** The number of weeks in {@link CockpitSchema}'s `pace`. */
export const COCKPIT_PACE_WEEKS = 12;

/**
 * A pull request that deserves a human look, and the one fact that says why.
 *
 * These are not a score and are not added to one. Each kind is a plain statement about a pull
 * request the delivery sync already stored, so a reader can check it against GitHub:
 *
 * - `large_change_without_tests`: a lot of lines changed and no test file among them.
 * - `merged_without_human_approval`: merged with no approval from a person other than the author.
 * - `ai_change_awaiting_human`: attributed to an agent or AI assistance, open, with no human approval.
 *
 * A pull request whose authorship could not be attributed is never treated as AI.
 */
export const COCKPIT_RISK_KINDS = [
  'large_change_without_tests',
  'merged_without_human_approval',
  'ai_change_awaiting_human',
] as const;
export const CockpitRiskKindSchema = z.enum(COCKPIT_RISK_KINDS);
export type CockpitRiskKind = z.infer<typeof CockpitRiskKindSchema>;

export const CockpitRiskItemSchema = z.object({
  kind: CockpitRiskKindSchema,
  number: z.number().int().min(1),
  title: z.string().min(1),
  /** The pull request on GitHub, when the project has a GitHub repository. */
  url: z.string().url().nullable(),
  /** One sentence stating the fact, with its numbers. */
  detail: z.string().min(1),
  /** When the pull request was merged, or opened if it is still open. */
  at: z.iso.datetime(),
});
export type CockpitRiskItem = z.infer<typeof CockpitRiskItemSchema>;

/** `total` counts every match; `items` are the most recent {@link COCKPIT_RISK_ITEMS}. */
export const COCKPIT_RISK_ITEMS = 10;
export const CockpitRisksSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(CockpitRiskItemSchema).max(COCKPIT_RISK_ITEMS).readonly(),
});
export type CockpitRisks = z.infer<typeof CockpitRisksSchema>;

/** `GET /api/v1/cockpit` */
export const CockpitSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  branch: z.string().min(1),
  window: CockpitWindowSchema,
  generatedAt: z.iso.datetime(),
  /** Where the compared period starts. `null` when `release` was asked and nothing has shipped. */
  since: z.iso.datetime().nullable(),
  /** One sentence. The only prose in the payload that is not a label. */
  headline: z.string().min(1),
  overall: CockpitOverallSchema,
  formulaBreak: CockpitFormulaBreakSchema.nullable(),
  metrics: z.array(CockpitMetricSchema).readonly(),
  /** The last twelve weeks, oldest first: how fast the change landed against how the score moved. */
  pace: z.array(CockpitPaceWeekSchema).length(COCKPIT_PACE_WEEKS).readonly(),
  /** Pull requests worth a look, from what the delivery sync stored. */
  risks: CockpitRisksSchema,
  repository: z.object({ owner: z.string().min(1), repo: z.string().min(1) }).nullable(),
});
export type Cockpit = z.infer<typeof CockpitSchema>;
