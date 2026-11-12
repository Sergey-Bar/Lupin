import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { paceReport, type PaceInput, type PaceMerge } from './pace.js';

/**
 * Property suite for PACE-1 and PACE-2. Fixed seed and `numRuns`, so a red run reproduces.
 */
const SEED = 20261112;
const params = { seed: SEED, numRuns: 400 } as const;
const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY = 86_400_000;

const merge: fc.Arbitrary<PaceMerge> = fc.record({
  mergedAt: fc.integer({ min: 0, max: 60 }).map((days) => new Date(NOW.getTime() - days * DAY)),
  additions: fc.nat({ max: 2000 }),
  deletions: fc.nat({ max: 2000 }),
  attribution: fc.constantFrom('human' as const, 'agent-authored' as const, 'unknown' as const),
  testsTouched: fc.boolean(),
  coverage: fc.option(
    fc.record({ executable: fc.nat({ max: 500 }), covered: fc.nat({ max: 500 }) }),
    { nil: null },
  ),
});

const input: fc.Arbitrary<PaceInput> = fc.record({
  projectId: fc.constant('p'),
  now: fc.constant(NOW),
  weeks: fc.integer({ min: 1, max: 10 }),
  merges: fc.array(merge, { maxLength: 30 }),
  firstSeen: fc.constant([]),
});

describe('PACE-1: unmeasured coverage is never counted as covered', () => {
  it('holds: removing a merge’s coverage never lowers the unmeasured lines, nor raises a pass', () => {
    fc.assert(
      fc.property(input, (value) => {
        const blind = {
          ...value,
          merges: (value.merges ?? []).map((m) => ({ ...m, coverage: null })),
        };
        const report = paceReport(blind);
        const lines = report.weeks.reduce((sum, week) => sum + week.changedLines, 0);
        expect(report.debt.unmeasuredLines).toBe(lines);
        expect(report.debt.uncoveredLines).toBe(0);
      }),
      params,
    );
  });

  it('pins one merge with no coverage', () => {
    const report = paceReport({
      projectId: 'p',
      now: NOW,
      weeks: 1,
      merges: [
        {
          mergedAt: NOW,
          additions: 10,
          deletions: 0,
          attribution: 'human',
          testsTouched: false,
          coverage: null,
        },
      ],
      firstSeen: [],
    });
    expect(report.debt).toEqual({ uncoveredLines: 0, unmeasuredLines: 10 });
  });
});

describe('PACE-2: the debt never decreases week over week', () => {
  it('holds for any merges', () => {
    fc.assert(
      fc.property(input, (value) => {
        const weeks = paceReport(value).weeks;
        for (let index = 1; index < weeks.length; index += 1) {
          expect(weeks[index]?.debt ?? 0).toBeGreaterThanOrEqual(weeks[index - 1]?.debt ?? 0);
        }
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes a debt that is each week’s own uncovered lines rather than a running total', () => {
    const outcome = fc.check(
      fc.property(input, (value) => {
        const weeks = paceReport(value).weeks;
        return weeks.every((week) => week.debt === week.uncoveredLines);
      }),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
