import {
  SDLC_PHASES,
  type PhaseBandEntry,
  type PhaseState,
  type PhaseStep,
  type PhaseStrip,
  type SdlcPhase,
  type Shape,
} from '@lupin/shared-contracts';
import type { Attribution } from './ai-attribution.js';

/**
 * The SDLC phases of one change — plan, code, test, review, release — read from what was
 * recorded about it. Pure.
 *
 * Two rules decide everything here:
 * - **PHASE-1:** a phase with no evidence is `not_measured`, never `done`.
 * - **PHASE-2:** a phase a change went past — a later phase done while this one was not — is
 *   `skipped`. Merged with no human approval skips review; approved with no tests on the head
 *   skips test.
 *
 * Thresholds are hours in a phase before an open change counts as stuck; a versioned constant a
 * project may override.
 */

export const SDLC_VERSION = 'sdlc/1';

export const PHASE_THRESHOLD_HOURS: Readonly<Record<'code' | 'review' | 'release', number>> = {
  code: 72,
  review: 48,
  release: 24,
};

export interface PhaseInput {
  pullRequest: number;
  now: Date;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  attribution: Attribution;
  /** The change's assessed risk is high or critical. */
  highRisk: boolean;
  /** The pull request names an issue; `null` when its body was not read. */
  linkedIssue: boolean | null;
  firstCommitAt: Date | null;
  openedAt: Date;
  /** Tests on the head commit; `null` when no run on it was read. */
  testsOnHead: { ran: boolean; tampered: boolean } | null;
  firstReviewAt: Date | null;
  approvedAt: Date | null;
  humanApprovals: number;
  mergedAt: Date | null;
  /** Whether the gate passed on the merged head; `null` when it was never assessed. */
  gatePassedAtMerge: boolean | null;
  thresholds?: Partial<typeof PHASE_THRESHOLD_HOURS>;
}

const HOUR = 3_600_000;
const hoursBetween = (from: Date | null, to: Date | null) =>
  from === null || to === null
    ? null
    : Math.max(0, Math.round(((to.getTime() - from.getTime()) / HOUR) * 10) / 10);

type Draft = Omit<PhaseStep, 'phase'>;

const step = (
  state: PhaseState,
  shape: Shape,
  reason: string,
  hours: number | null = null,
): Draft => ({
  state,
  shape,
  reason,
  hours,
});

const isAi = (attribution: Attribution) =>
  attribution === 'agent-authored' || attribution === 'ai-assisted';

function plan(input: PhaseInput): Draft {
  if (input.linkedIssue === null)
    return step('not_measured', 'unknown', 'The pull request’s description was not read.');
  if (input.linkedIssue) return step('done', 'good', 'Names the issue it works on.');
  return step(
    'skipped',
    input.highRisk ? 'bad' : 'caution',
    input.highRisk ? 'A high-risk change with no issue behind it.' : 'Names no issue it works on.',
  );
}

function stuckOrNot(
  phase: 'code' | 'review' | 'release',
  hours: number | null,
  limit: number,
  waiting: string,
): Draft {
  const over = hours !== null && hours > limit;
  return step(
    'in_progress',
    over ? 'caution' : 'good',
    over ? `${waiting} for ${String(hours)} hours.` : `${waiting}.`,
    hours,
  );
}

function code(input: PhaseInput, limits: typeof PHASE_THRESHOLD_HOURS): Draft {
  const started = input.firstCommitAt ?? input.openedAt;
  if (input.state === 'open' && input.draft) {
    return stuckOrNot('code', hoursBetween(started, input.now), limits.code, 'Still a draft');
  }
  return step(
    'done',
    'good',
    'Opened for review.',
    hoursBetween(input.firstCommitAt, input.openedAt),
  );
}

function test(input: PhaseInput): Draft {
  const tests = input.testsOnHead;
  if (tests === null)
    return step('not_measured', 'unknown', 'No test run on the head commit was read.');
  if (tests.ran) {
    return tests.tampered
      ? step('done', 'bad', 'Tests ran, but the change weakened them.')
      : step('done', 'good', 'Tests ran on the head commit.');
  }
  if (input.state === 'merged')
    return step('skipped', 'bad', 'Merged with no tests run on its head.');
  return step(
    input.draft ? 'pending' : 'in_progress',
    'good',
    'No tests have run on the head yet.',
  );
}

function review(input: PhaseInput, limits: typeof PHASE_THRESHOLD_HOURS): Draft {
  if (input.humanApprovals > 0) {
    return step(
      'done',
      'good',
      'Approved by a person.',
      hoursBetween(input.openedAt, input.approvedAt),
    );
  }
  if (input.state === 'merged') {
    return isAi(input.attribution)
      ? step('skipped', 'bad', 'AI-written and merged with no person approving it.')
      : step('skipped', 'caution', 'Merged with no person approving it.');
  }
  if (input.state === 'closed' || input.draft)
    return step('pending', 'good', 'Not ready for review.');
  return stuckOrNot(
    'review',
    hoursBetween(input.openedAt, input.now),
    limits.review,
    'Waiting for review',
  );
}

function release(
  input: PhaseInput,
  reviewed: boolean,
  limits: typeof PHASE_THRESHOLD_HOURS,
): Draft {
  if (input.state === 'merged') {
    const hours = hoursBetween(input.approvedAt ?? input.openedAt, input.mergedAt);
    return input.gatePassedAtMerge === false
      ? step('done', 'bad', 'Merged while the gate was failing.', hours)
      : step('done', 'good', 'Merged.', hours);
  }
  if (input.state === 'open' && reviewed) {
    return stuckOrNot(
      'release',
      hoursBetween(input.approvedAt, input.now),
      limits.release,
      'Approved and not merged',
    );
  }
  return step(
    'pending',
    'good',
    input.state === 'closed' ? 'Closed without merging.' : 'Not approved yet.',
  );
}

/** What it means to go past a phase without doing it, where the phase did not say so itself. */
const PASSED_OVER: Readonly<Record<SdlcPhase, { shape: Shape; reason: string }>> = {
  plan: { shape: 'caution', reason: 'Went ahead with no plan recorded.' },
  code: { shape: 'caution', reason: 'Went ahead while still a draft.' },
  test: { shape: 'bad', reason: 'Went past testing with no tests on the head commit.' },
  review: { shape: 'bad', reason: 'Went past review with no person approving it.' },
  release: { shape: 'caution', reason: 'Not released.' },
};

/** PHASE-2: a phase not done, with a later one done, was skipped. Unmeasured stays unmeasured. */
function markPassedOver(steps: Array<PhaseStep>): void {
  for (const [index, entry] of steps.entries()) {
    if (entry.state !== 'pending' && entry.state !== 'in_progress') continue;
    if (!steps.slice(index + 1).some((later) => later.state === 'done')) continue;
    const passed = PASSED_OVER[entry.phase];
    steps[index] = {
      ...entry,
      state: 'skipped',
      shape: passed.shape,
      reason: passed.reason,
      hours: null,
    };
  }
}

/** Bad beats caution; a strip with anything unmeasured is never good; all unmeasured is unknown. */
export function worstShape(shapes: readonly Shape[]): Shape {
  if (shapes.includes('bad')) return 'bad';
  if (shapes.length === 0 || shapes.every((shape) => shape === 'unknown')) return 'unknown';
  if (shapes.includes('caution') || shapes.includes('unknown')) return 'caution';
  return 'good';
}

export function phaseStrip(input: PhaseInput): PhaseStrip {
  const limits = { ...PHASE_THRESHOLD_HOURS, ...input.thresholds };
  const reviewed = input.humanApprovals > 0;
  const drafts: Record<SdlcPhase, Draft> = {
    plan: plan(input),
    code: code(input, limits),
    test: test(input),
    review: review(input, limits),
    release: release(input, reviewed, limits),
  };
  const steps: PhaseStep[] = SDLC_PHASES.map((phase) => ({ phase, ...drafts[phase] }));
  markPassedOver(steps);
  return {
    version: SDLC_VERSION,
    pullRequest: input.pullRequest,
    phases: steps,
    shape: worstShape(steps.map((entry) => entry.shape)),
    skipped: steps.filter((entry) => entry.state === 'skipped').map((entry) => entry.phase),
  };
}

const ISSUE_PATTERNS = [
  /(?:^|[\s(])#\d+\b/u,
  /\b[\w.-]+\/[\w.-]+#\d+\b/u,
  /\/issues\/\d+\b/u,
  /\b[A-Z][A-Z0-9]{1,9}-\d+\b/u,
];

/** Whether a pull request's description names an issue: `#12`, `owner/repo#4`, a URL, a `PROJ-1` key. */
export function linksAnIssue(body: string | null): boolean | null {
  if (body === null) return null;
  return ISSUE_PATTERNS.some((pattern) => pattern.test(body));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const phrase = (count: number, total: number) =>
  `${String(count)} of ${String(total)} ${total === 1 ? 'change' : 'changes'}`;

function bandReason(entry: Omit<PhaseBandEntry, 'reason'>, bad: number): string {
  if (entry.measured === 0) return 'Not measured for any change.';
  if (entry.skipped > 0) return `${phrase(entry.skipped, entry.measured)} skipped ${entry.phase}.`;
  if (bad > 0) return `${phrase(bad, entry.measured)} had a problem in ${entry.phase}.`;
  if (entry.stuck > 0) return `${phrase(entry.stuck, entry.measured)} stuck in ${entry.phase}.`;
  return `${phrase(entry.done, entry.measured)} done ${entry.phase}.`;
}

/** Each phase across a repository's changes: how many did it, skipped it, are stuck in it. */
export function phaseBand(strips: readonly PhaseStrip[]): PhaseBandEntry[] {
  return SDLC_PHASES.map((phase) => {
    const steps = strips.flatMap((strip) => strip.phases.filter((entry) => entry.phase === phase));
    const measured = steps.filter((entry) => entry.state !== 'not_measured');
    const bad = measured.filter((entry) => entry.shape === 'bad').length;
    const entry: Omit<PhaseBandEntry, 'reason'> = {
      phase,
      shape: measured.length === 0 ? 'unknown' : worstShape(measured.map((each) => each.shape)),
      measured: measured.length,
      done: measured.filter((each) => each.state === 'done').length,
      skipped: measured.filter((each) => each.state === 'skipped').length,
      stuck: measured.filter((each) => each.state === 'in_progress' && each.shape === 'caution')
        .length,
      medianHours: median(
        measured.flatMap((each) =>
          each.state === 'done' && each.hours !== null ? [each.hours] : [],
        ),
      ),
    };
    return { ...entry, reason: bandReason(entry, bad) };
  });
}
