import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SHAPES } from '@lupin/shared-contracts';
import { SHAPE_STALE_DAYS, shapeReading, type ShapeInputSignal } from './shape.js';

/**
 * Property suite for SHAPE-1, SHAPE-2 and SHAPE-3 in `docs/quality/property-invariants.json`.
 * Fixed seed and `numRuns`.
 */
const SEED = 20261115;
const params = { seed: SEED, numRuns: 400 } as const;
const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY = 86_400_000;

const signal: fc.Arbitrary<ShapeInputSignal> = fc.record({
  id: fc.constantFrom('grade' as const, 'tests' as const, 'phases' as const, 'risk' as const),
  shape: fc.constantFrom(...SHAPES),
  at: fc.option(
    fc
      .integer({ min: 0, max: 60 * 24 })
      .map((hours) => new Date(NOW.getTime() - hours * 3_600_000)),
    { nil: null },
  ),
  reason: fc.string({ minLength: 1, maxLength: 40 }),
});
const signals = fc.array(signal, { maxLength: 6 });
const RANK = { bad: 0, caution: 1, unknown: 2, good: 3 } as const;

describe('SHAPE-1: a signal that was not measured keeps the verdict from being good', () => {
  it('holds for any set of signals', () => {
    fc.assert(
      fc.property(signals, (list) => {
        const missing = list.some((entry) => entry.shape === 'unknown' || entry.at === null);
        if (missing) expect(shapeReading(list, NOW).shape).not.toBe('good');
      }),
      params,
    );
  });
});

describe('SHAPE-2: evidence older than the stale window keeps the verdict from being good', () => {
  it('holds when every signal is older than the window', () => {
    const old = signal.map((entry) => ({
      ...entry,
      at: new Date(NOW.getTime() - (SHAPE_STALE_DAYS + 1) * DAY - (entry.at === null ? 0 : 1)),
    }));
    fc.assert(
      fc.property(fc.array(old, { minLength: 1, maxLength: 6 }), (list) => {
        const reading = shapeReading(list, NOW);
        expect(reading.shape).not.toBe('good');
        if (list.some((entry) => entry.shape !== 'unknown'))
          expect(reading.freshness).toBe('stale');
      }),
      params,
    );
  });
});

describe('SHAPE-3: adding a bad signal never improves the verdict', () => {
  it('holds for any set of signals and any bad signal added to it', () => {
    fc.assert(
      fc.property(signals, signal, (list, extra) => {
        const before = shapeReading(list, NOW).shape;
        const after = shapeReading([...list, { ...extra, shape: 'bad' }], NOW).shape;
        // Order: bad, caution, unknown, good. A bad signal only ever moves the verdict down it.
        expect(RANK[after]).toBeLessThanOrEqual(RANK[before]);
        expect(after).not.toBe('good');
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes a reading that calls a missing signal good', () => {
    const wrong = (list: readonly ShapeInputSignal[]) =>
      list.every((entry) => entry.shape !== 'bad' && entry.shape !== 'caution') ? 'good' : 'bad';
    const result = fc.check(
      fc.property(signals, (list) => {
        const missing = list.some((entry) => entry.shape === 'unknown' || entry.at === null);
        return !missing || wrong(list) !== 'good';
      }),
      params,
    );
    expect(result.failed).toBe(true);
  });
});
