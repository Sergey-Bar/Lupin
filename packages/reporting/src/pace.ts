import type { PaceReport, PaceWeek } from '@lupin/shared-contracts';
import type { Attribution } from './ai-attribution.js';

/**
 * Pace: whether testing keeps up with the code. Pure, over merged pull requests and the dates
 * tests were first seen.
 *
 * Every number is a count of something that happened, so nothing here is a judgement:
 * - **changed lines** and their **AI share**, from merged pull requests;
 * - the **tested share**: lines in pull requests that touched a test file;
 * - **new tests**: identities first seen in a run that week, per 1,000 changed lines;
 * - **untested-change debt**: executable changed lines that merged and that no test ran, summed
 *   week over week. Lines with no diff coverage measured are counted apart, as unmeasured —
 *   never as covered (PACE-1), and the debt never goes down (PACE-2).
 */

export const PACE_VERSION = 'pace/1';
/** Weeks needed before a week can be compared with the one before it. */
export const PACE_MIN_WEEKS = 2;
const WEEK_MS = 7 * 86_400_000;

export interface PaceMerge {
  mergedAt: Date;
  additions: number;
  deletions: number;
  attribution: Attribution;
  testsTouched: boolean;
  /** The head commit's diff coverage; `null` when it was not measured. */
  coverage: { executable: number; covered: number } | null;
}

export interface PaceInput {
  projectId: string;
  now: Date;
  weeks: number;
  /** `null` when the delivery sync has never read this project's pull requests. */
  merges: readonly PaceMerge[] | null;
  /** When each test identity was first seen; `null` when no run is readable. */
  firstSeen: readonly Date[] | null;
  /** The read of merges stopped at its bound. */
  truncated?: boolean;
}

/** Monday 00:00 UTC of the week holding `at`. */
export function weekStartOf(at: Date): Date {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * 86_400_000);
}

const nonNegative = (value: number) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const ratio = (part: number, whole: number) => (whole === 0 ? null : Math.min(1, part / whole));
const isAi = (attribution: Attribution) =>
  attribution === 'agent-authored' || attribution === 'ai-assisted';

interface Bucket {
  merges: PaceMerge[];
  tests: number;
}

function weekOf(start: Date, bucket: Bucket, testsKnown: boolean, debtBefore: number): PaceWeek {
  let changed = 0;
  let ai = 0;
  let tested = 0;
  let uncovered = 0;
  let unmeasured = 0;
  for (const merge of bucket.merges) {
    const lines = nonNegative(merge.additions) + nonNegative(merge.deletions);
    changed += lines;
    if (isAi(merge.attribution)) ai += lines;
    if (merge.testsTouched) tested += lines;
    if (merge.coverage === null) unmeasured += lines;
    else {
      const executable = nonNegative(merge.coverage.executable);
      uncovered += executable - Math.min(executable, nonNegative(merge.coverage.covered));
    }
  }
  const testsAdded = testsKnown ? bucket.tests : null;
  return {
    weekStart: start.toISOString(),
    mergedPullRequests: bucket.merges.length,
    changedLines: changed,
    aiShare: ratio(ai, changed),
    testedShare: ratio(tested, changed),
    testsAdded,
    testsPerKloc:
      testsAdded === null || changed === 0
        ? null
        : Math.round((testsAdded / changed) * 1000 * 10) / 10,
    uncoveredLines: uncovered,
    unmeasuredLines: unmeasured,
    debt: debtBefore + uncovered,
  };
}

const formatLines = (count: number) => count.toLocaleString('en-US');

function headlineOf(weeks: readonly PaceWeek[], status: PaceReport['status']): string {
  if (status === 'not_configured') {
    return 'Nothing merged is known yet: turn on delivery sync for this repository.';
  }
  const last = weeks.at(-1);
  const debt = last?.debt ?? 0;
  if (last === undefined || last.changedLines === 0) {
    return `Nothing merged this week; ${formatLines(debt)} untested changed lines merged in the window.`;
  }
  const lines = `${formatLines(last.changedLines)} lines changed this week`;
  const ai =
    last.aiShare === null ? '' : ` (${String(Math.round(last.aiShare * 100))}% AI-written)`;
  const tests =
    last.testsPerKloc === null
      ? 'new tests were not measured'
      : `${String(last.testsAdded)} new tests, ${String(last.testsPerKloc)} per 1,000 lines`;
  return `${lines}${ai}; ${tests}; ${formatLines(debt)} untested changed lines merged in the window.`;
}

export function paceReport(input: PaceInput): PaceReport {
  const count = Math.min(52, Math.max(1, Math.floor(input.weeks)));
  const lastStart = weekStartOf(input.now);
  const starts = Array.from(
    { length: count },
    (_, index) => new Date(lastStart.getTime() - (count - 1 - index) * WEEK_MS),
  );
  const first = starts[0] as Date;
  const buckets = starts.map((): Bucket => ({ merges: [], tests: 0 }));
  const indexOf = (at: Date) => {
    const index = Math.floor((weekStartOf(at).getTime() - first.getTime()) / WEEK_MS);
    return index >= 0 && index < count ? index : -1;
  };
  for (const merge of input.merges ?? []) {
    const index = indexOf(merge.mergedAt);
    if (index >= 0) buckets[index]?.merges.push(merge);
  }
  for (const seen of input.firstSeen ?? []) {
    const index = indexOf(seen);
    if (index >= 0) (buckets[index] as Bucket).tests += 1;
  }
  const weeks: PaceWeek[] = [];
  let debt = 0;
  for (const [index, start] of starts.entries()) {
    const week = weekOf(start, buckets[index] as Bucket, input.firstSeen !== null, debt);
    debt = week.debt;
    weeks.push(week);
  }
  const merged = weeks.filter((week) => week.mergedPullRequests > 0).length;
  const status: PaceReport['status'] =
    input.merges === null
      ? 'not_configured'
      : merged < PACE_MIN_WEEKS
        ? 'insufficient'
        : 'measured';
  return {
    projectId: input.projectId,
    version: PACE_VERSION,
    evaluatedAt: input.now.toISOString(),
    status,
    headline: headlineOf(weeks, status),
    weeks,
    debt: {
      uncoveredLines: debt,
      unmeasuredLines: weeks.reduce((sum, week) => sum + week.unmeasuredLines, 0),
    },
    truncated: input.truncated === true,
  };
}
