import { SDLC_PHASES } from '@lupin/shared-contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { phaseStrip, type PhaseInput } from './sdlc-phases.js';

/** Property suite for PHASE-1 and PHASE-2. Fixed seed and `numRuns`. */
const SEED = 20261113;
const params = { seed: SEED, numRuns: 500 } as const;
const NOW = new Date('2026-11-11T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

const maybeDate = fc.option(fc.integer({ min: 0, max: 500 }).map(ago), { nil: null });

const input: fc.Arbitrary<PhaseInput> = fc.record({
  pullRequest: fc.integer({ min: 1, max: 9999 }),
  now: fc.constant(NOW),
  state: fc.constantFrom('open' as const, 'closed' as const, 'merged' as const),
  draft: fc.boolean(),
  attribution: fc.constantFrom(
    'human' as const,
    'agent-authored' as const,
    'ai-assisted' as const,
    'unknown' as const,
  ),
  highRisk: fc.boolean(),
  linkedIssue: fc.option(fc.boolean(), { nil: null }),
  firstCommitAt: maybeDate,
  openedAt: fc.integer({ min: 0, max: 500 }).map(ago),
  testsOnHead: fc.option(fc.record({ ran: fc.boolean(), tampered: fc.boolean() }), { nil: null }),
  firstReviewAt: maybeDate,
  approvedAt: maybeDate,
  humanApprovals: fc.nat({ max: 3 }),
  mergedAt: maybeDate,
  gatePassedAtMerge: fc.option(fc.boolean(), { nil: null }),
});

describe('PHASE-1: a phase with no evidence is never done', () => {
  it('holds: no linked-issue reading, no plan done; no test run read, no test done', () => {
    fc.assert(
      fc.property(input, (value) => {
        const strip = phaseStrip({ ...value, linkedIssue: null, testsOnHead: null });
        expect(strip.phases[0]?.state).toBe('not_measured');
        expect(strip.phases[2]?.state).toBe('not_measured');
        expect(strip.shape).not.toBe('good');
      }),
      params,
    );
  });
});

describe('PHASE-2: a later phase done ahead of an earlier one makes the earlier one skipped', () => {
  it('holds: no phase is pending or in progress while a later phase is done', () => {
    fc.assert(
      fc.property(input, (value) => {
        const phases = phaseStrip(value).phases;
        for (const [index, entry] of phases.entries()) {
          const laterDone = phases.slice(index + 1).some((later) => later.state === 'done');
          if (laterDone) expect(['done', 'skipped', 'not_measured']).toContain(entry.state);
        }
        expect(phases.map((entry) => entry.phase)).toEqual([...SDLC_PHASES]);
      }),
      params,
    );
  });

  it('pins a merged change with nothing measured but the merge', () => {
    const strip = phaseStrip({
      pullRequest: 1,
      now: NOW,
      state: 'merged',
      draft: false,
      attribution: 'agent-authored',
      highRisk: true,
      linkedIssue: false,
      firstCommitAt: null,
      openedAt: ago(5),
      testsOnHead: { ran: false, tampered: false },
      firstReviewAt: null,
      approvedAt: null,
      humanApprovals: 0,
      mergedAt: ago(1),
      gatePassedAtMerge: null,
    });
    expect(strip.skipped).toEqual(['plan', 'test', 'review']);
    expect(strip.shape).toBe('bad');
  });
});

describe('the property harness can fail', () => {
  it('refutes a strip that never marks anything skipped', () => {
    const outcome = fc.check(
      fc.property(input, (value) => phaseStrip(value).skipped.length === 0),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
