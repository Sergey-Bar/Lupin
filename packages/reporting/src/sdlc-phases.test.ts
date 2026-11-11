import { PhaseStripSchema } from '@lupin/shared-contracts';
import { describe, expect, it } from 'vitest';
import {
  PHASE_THRESHOLD_HOURS,
  SDLC_VERSION,
  linksAnIssue,
  phaseBand,
  phaseStrip,
  type PhaseInput,
} from './sdlc-phases.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

/** A human change that went through every phase, merged an hour ago. */
const done = (overrides: Partial<PhaseInput> = {}): PhaseInput => ({
  pullRequest: 7,
  now: NOW,
  state: 'merged',
  draft: false,
  attribution: 'human',
  highRisk: false,
  linkedIssue: true,
  firstCommitAt: hoursAgo(30),
  openedAt: hoursAgo(26),
  testsOnHead: { ran: true, tampered: false },
  firstReviewAt: hoursAgo(10),
  approvedAt: hoursAgo(6),
  humanApprovals: 1,
  mergedAt: hoursAgo(1),
  gatePassedAtMerge: true,
  ...overrides,
});

const states = (input: PhaseInput) =>
  phaseStrip(input).phases.map((step) => `${step.phase}:${step.state}:${step.shape}`);

describe('phaseStrip', () => {
  it('reads a change that did everything as done and good, with the hours in each phase', () => {
    const strip = phaseStrip(done());
    expect(PhaseStripSchema.safeParse(strip).success).toBe(true);
    expect(strip).toMatchObject({
      version: SDLC_VERSION,
      pullRequest: 7,
      shape: 'good',
      skipped: [],
    });
    expect(strip.phases.map((step) => [step.phase, step.state, step.hours])).toEqual([
      ['plan', 'done', null],
      ['code', 'done', 4],
      ['test', 'done', null],
      ['review', 'done', 20],
      ['release', 'done', 5],
    ]);
  });

  it('reads an AI change merged with no human review as review skipped, and bad', () => {
    const strip = phaseStrip(
      done({
        attribution: 'agent-authored',
        humanApprovals: 0,
        approvedAt: null,
        firstReviewAt: null,
      }),
    );
    expect(strip.phases[3]).toMatchObject({ phase: 'review', state: 'skipped', shape: 'bad' });
    expect(strip.phases[3]?.reason).toBe('AI-written and merged with no person approving it.');
    expect(strip.skipped).toEqual(['review']);
    expect(strip.shape).toBe('bad');
  });

  it('reads a human change merged unreviewed as skipped, and caution', () => {
    expect(states(done({ humanApprovals: 0, approvedAt: null }))[3]).toBe('review:skipped:caution');
  });

  it('reads tests that never ran on a merged head as skipped and bad, and tampering as bad', () => {
    expect(states(done({ testsOnHead: { ran: false, tampered: false } }))[2]).toBe(
      'test:skipped:bad',
    );
    const tampered = phaseStrip(done({ testsOnHead: { ran: true, tampered: true } }));
    expect(tampered.phases[2]).toMatchObject({ state: 'done', shape: 'bad' });
    expect(tampered.phases[2]?.reason).toBe('Tests ran, but the change weakened them.');
  });

  it('never calls a phase done without its evidence', () => {
    expect(states(done({ linkedIssue: null, testsOnHead: null, firstCommitAt: null }))).toEqual([
      'plan:not_measured:unknown',
      'code:done:good',
      'test:not_measured:unknown',
      'review:done:good',
      'release:done:good',
    ]);
  });

  it('reads no linked issue as plan skipped, bad only for a high-risk change', () => {
    expect(states(done({ linkedIssue: false }))[0]).toBe('plan:skipped:caution');
    expect(states(done({ linkedIssue: false, highRisk: true }))[0]).toBe('plan:skipped:bad');
  });

  it('reads a merge past a failing gate as release bad', () => {
    const strip = phaseStrip(done({ gatePassedAtMerge: false }));
    expect(strip.phases[4]).toMatchObject({ state: 'done', shape: 'bad' });
    expect(strip.phases[4]?.reason).toBe('Merged while the gate was failing.');
  });

  it('walks an open change: draft is coding, waiting is review, approved is release', () => {
    const open = { state: 'open' as const, mergedAt: null, gatePassedAtMerge: null };
    expect(
      states(
        done({
          ...open,
          draft: true,
          firstReviewAt: null,
          approvedAt: null,
          humanApprovals: 0,
          testsOnHead: null,
        }),
      ),
    ).toEqual([
      'plan:done:good',
      'code:in_progress:good',
      'test:not_measured:unknown',
      'review:pending:good',
      'release:pending:good',
    ]);
    expect(states(done({ ...open, approvedAt: null, humanApprovals: 0 }))[3]).toBe(
      'review:in_progress:good',
    );
    expect(states(done({ ...open }))[4]).toBe('release:in_progress:good');
  });

  it('calls a phase stuck past its threshold caution, with the hours', () => {
    const waited = PHASE_THRESHOLD_HOURS.review + 5;
    const strip = phaseStrip(
      done({
        state: 'open',
        mergedAt: null,
        openedAt: hoursAgo(waited),
        approvedAt: null,
        humanApprovals: 0,
        firstReviewAt: null,
      }),
    );
    expect(strip.phases[3]).toMatchObject({
      state: 'in_progress',
      shape: 'caution',
      hours: waited,
    });
    expect(strip.phases[3]?.reason).toBe(`Waiting for review for ${String(waited)} hours.`);
  });

  it('reads a closed, unmerged change as never released, with nothing skipped', () => {
    const strip = phaseStrip(
      done({
        state: 'closed',
        mergedAt: null,
        approvedAt: null,
        humanApprovals: 0,
        gatePassedAtMerge: null,
      }),
    );
    expect(strip.phases[4]).toMatchObject({ state: 'pending', shape: 'good' });
    expect(strip.skipped).toEqual([]);
  });
});

describe('linksAnIssue', () => {
  it.each([
    ['Fixes #12', true],
    ['closes acme/shop#4', true],
    ['See https://github.com/acme/shop/issues/9', true],
    ['Implements PROJ-123', true],
    ['Refactor the cart', false],
    ['Bump version to 1.2#3', false],
  ])('%s → %s', (body, expected) => {
    expect(linksAnIssue(body)).toBe(expected);
  });

  it('cannot say without a body', () => {
    expect(linksAnIssue(null)).toBeNull();
  });
});

describe('phaseBand', () => {
  it('rolls each phase up: done, skipped, stuck, the median, and the worst shape', () => {
    const strips = [
      phaseStrip(done()),
      phaseStrip(
        done({
          pullRequest: 8,
          attribution: 'agent-authored',
          humanApprovals: 0,
          approvedAt: null,
        }),
      ),
      phaseStrip(done({ pullRequest: 9, linkedIssue: null })),
    ];
    const band = phaseBand(strips);
    const review = band.find((entry) => entry.phase === 'review');
    expect(review).toMatchObject({
      shape: 'bad',
      measured: 3,
      done: 2,
      skipped: 1,
      stuck: 0,
      medianHours: 20,
    });
    expect(review?.reason).toBe('1 of 3 changes skipped review.');
    expect(band.find((entry) => entry.phase === 'plan')).toMatchObject({
      measured: 2,
      done: 2,
      shape: 'good',
    });
  });

  it('is unknown for a phase nobody measured, and for no changes at all', () => {
    expect(
      phaseBand([phaseStrip(done({ testsOnHead: null }))]).find((entry) => entry.phase === 'test'),
    ).toMatchObject({
      shape: 'unknown',
      measured: 0,
      reason: 'Not measured for any change.',
    });
    expect(phaseBand([]).every((entry) => entry.shape === 'unknown')).toBe(true);
  });
});
