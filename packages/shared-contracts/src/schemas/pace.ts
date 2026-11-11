import { z } from 'zod/v4';

/**
 * Pace: whether testing keeps up with how fast the code changes.
 *
 * Read per repository and per week from what merged: how many lines changed and how much of
 * that was AI-written, how much came with a test change, how many new tests appeared, and the
 * changed lines that merged with no test running them — the **untested-change debt**, a running
 * total that only grows. Lines nobody measured are counted as unmeasured, never as covered.
 */

export const PaceWeekSchema = z.object({
  /** Monday 00:00 UTC. */
  weekStart: z.iso.datetime({ offset: true }),
  mergedPullRequests: z.number().int().min(0),
  changedLines: z.number().int().min(0),
  /** AI-attributed lines over changed lines, 0–1; `null` with nothing merged or nothing attributed. */
  aiShare: z.number().min(0).max(1).nullable(),
  /** Lines in pull requests that touched a test file, over changed lines, 0–1. */
  testedShare: z.number().min(0).max(1).nullable(),
  /** Tests seen for the first time this week; `null` when no run was read. */
  testsAdded: z.number().int().min(0).nullable(),
  /** New tests per 1,000 changed lines; `null` when either side is unknown or nothing changed. */
  testsPerKloc: z.number().min(0).nullable(),
  /** Executable changed lines that merged and no test ran. */
  uncoveredLines: z.number().int().min(0),
  /** Changed lines of merged pull requests with no diff coverage measured. */
  unmeasuredLines: z.number().int().min(0),
  /** The running total of `uncoveredLines`, to the end of this week. Never decreases. */
  debt: z.number().int().min(0),
});
export type PaceWeek = z.infer<typeof PaceWeekSchema>;

export const PACE_STATUSES = ['measured', 'insufficient', 'not_configured'] as const;

export const PaceReportSchema = z.object({
  projectId: z.string().min(1),
  version: z.string().min(1),
  evaluatedAt: z.iso.datetime({ offset: true }),
  /**
   * `not_configured`: the delivery sync has read no pull request, so nothing merged is known.
   * `insufficient`: something merged, but fewer weeks than a comparison needs.
   */
  status: z.enum(PACE_STATUSES),
  /** One sentence: how fast code moved, how tests kept up, and the debt. */
  headline: z.string().min(1).max(300),
  /** Oldest first. */
  weeks: z.array(PaceWeekSchema),
  debt: z.object({
    uncoveredLines: z.number().int().min(0),
    unmeasuredLines: z.number().int().min(0),
  }),
  /** More pull requests merged in the window than were read; every count is a lower bound. */
  truncated: z.boolean(),
});
export type PaceReport = z.infer<typeof PaceReportSchema>;
