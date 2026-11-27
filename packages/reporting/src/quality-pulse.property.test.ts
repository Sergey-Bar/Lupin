import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { qualityPulse, type PulseInput, type PulseReading } from './quality-pulse.js';

/**
 * Property suite for PULSE-1 and PULSE-2.
 *
 * PULSE-1: the pulse is `worse` exactly when some sign is `worse`, so a regression can never
 * sit under a better or steady word.
 * PULSE-2: missing evidence never reads as good: with no sign comparable the pulse is
 * `unknown`, and a sign with a missing side is `unknown` rather than `steady`.
 */
const SEED = 20261126;
const params = { seed: SEED, numRuns: 300 } as const;

const value = fc.oneof(fc.constant(null), fc.double({ min: 0, max: 100, noNaN: true }));
const reading: fc.Arbitrary<PulseReading> = fc.record({ current: value, previous: value });
const gate: fc.Arbitrary<PulseReading> = fc.record({
  current: fc.constantFrom(null, 0, 1),
  previous: fc.constantFrom(null, 0, 1),
});

const pulseInput: fc.Arbitrary<PulseInput> = fc.record({
  projectId: fc.constant('p'),
  evaluatedAt: fc.constant('2026-11-26T00:00:00.000Z'),
  windowDays: fc.constant(7),
  runs: fc.record({ current: fc.nat(50), previous: fc.nat(50) }),
  gate,
  passRate: reading,
  failingTests: fc.record({
    current: fc.oneof(fc.constant(null), fc.nat(40)),
    previous: fc.oneof(fc.constant(null), fc.nat(40)),
  }),
  flakyRate: reading,
  coverage: reading,
  aiChangeFailureRate: reading,
  aiRevertRate: reading,
  aiDiffCoverage: reading,
});

describe('PULSE-1: one regression is news', () => {
  it('is worse exactly when some sign is worse', () => {
    fc.assert(
      fc.property(pulseInput, (input) => {
        const pulse = qualityPulse(input);
        const anyWorse = pulse.vitals.some((vital) => vital.direction === 'worse');
        expect(pulse.direction === 'worse').toBe(anyWorse);
        if (pulse.direction === 'worse') expect(pulse.cause).not.toBeNull();
      }),
      params,
    );
  });
});

describe('PULSE-2: missing evidence is never good', () => {
  it('a sign with either side missing is unknown, and no comparable sign makes the pulse unknown', () => {
    fc.assert(
      fc.property(pulseInput, (input) => {
        const pulse = qualityPulse(input);
        for (const vital of pulse.vitals) {
          if (vital.current === null || vital.previous === null) {
            expect(vital.direction).toBe('unknown');
          }
        }
        const comparable = pulse.vitals.some((vital) => vital.direction !== 'unknown');
        if (!comparable) expect(pulse.direction).toBe('unknown');
      }),
      { ...params, examples: [[{ ...emptyInput() }]] },
    );
  });

  it('the property harness can fail: a pulse that called missing evidence steady is caught', () => {
    const wrong: ReturnType<typeof qualityPulse> = {
      ...qualityPulse(emptyInput()),
      direction: 'steady',
    };
    const comparable = wrong.vitals.some((vital) => vital.direction !== 'unknown');
    expect(!comparable && wrong.direction !== 'unknown').toBe(true);
  });
});

function emptyInput(): PulseInput {
  const none = { current: null, previous: null };
  return {
    projectId: 'p',
    evaluatedAt: '2026-11-26T00:00:00.000Z',
    windowDays: 7,
    runs: { current: 0, previous: 0 },
    gate: none,
    passRate: none,
    failingTests: none,
    flakyRate: none,
    coverage: none,
    aiChangeFailureRate: none,
    aiRevertRate: none,
    aiDiffCoverage: none,
  };
}
