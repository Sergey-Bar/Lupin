import { ShapeReadingSchema } from '@lupin/shared-contracts';
import { describe, expect, it } from 'vitest';
import { SHAPE_STALE_DAYS, SHAPE_VERSION, shapeReading, type ShapeInputSignal } from './shape.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const signal = (overrides: Partial<ShapeInputSignal> = {}): ShapeInputSignal => ({
  id: 'grade',
  shape: 'good',
  at: daysAgo(1),
  reason: 'Grade B.',
  ...overrides,
});

describe('shapeReading', () => {
  it('is good when every signal was measured recently and is fine', () => {
    const reading = shapeReading(
      [signal(), signal({ id: 'tests', reason: 'The last run passed.', at: daysAgo(2) })],
      NOW,
    );
    expect(ShapeReadingSchema.safeParse(reading).success).toBe(true);
    expect(reading).toMatchObject({
      version: SHAPE_VERSION,
      shape: 'good',
      freshness: 'fresh',
      measuredAt: daysAgo(1).toISOString(),
      reason: 'Every signal was measured in the last 7 days and is fine.',
    });
  });

  it('is bad when any signal is bad, and says that signal’s reason first', () => {
    const reading = shapeReading(
      [
        signal({ id: 'tests', shape: 'caution', reason: 'A run was interrupted.' }),
        signal({ id: 'risk', shape: 'bad', reason: '1 open change at critical risk.' }),
      ],
      NOW,
    );
    expect(reading).toMatchObject({ shape: 'bad', reason: '1 open change at critical risk.' });
  });

  it('is never good with a signal missing, and names what is missing', () => {
    const reading = shapeReading(
      [signal(), signal({ id: 'tests', shape: 'unknown', at: null, reason: 'No run recorded.' })],
      NOW,
    );
    expect(reading).toMatchObject({ shape: 'caution', reason: 'Not measured: tests.' });
  });

  it('is never good on stale evidence, and says how old it is', () => {
    const reading = shapeReading([signal({ at: daysAgo(SHAPE_STALE_DAYS + 3) })], NOW);
    expect(reading).toMatchObject({
      shape: 'caution',
      freshness: 'stale',
      reason: 'Last measured 10 days ago.',
    });
  });

  it('keeps a stale bad verdict bad: old bad news is still bad news', () => {
    const reading = shapeReading([signal({ shape: 'bad', at: daysAgo(30) })], NOW);
    expect(reading).toMatchObject({ shape: 'bad', freshness: 'stale' });
  });

  it('is unknown, and never measured, with nothing measured', () => {
    expect(shapeReading([], NOW)).toMatchObject({
      shape: 'unknown',
      freshness: 'never',
      measuredAt: null,
      reason: 'Nothing has been measured yet.',
    });
    expect(
      shapeReading([signal({ shape: 'unknown', at: null, reason: 'No grade.' })], NOW).shape,
    ).toBe('unknown');
  });

  it('counts a signal with a shape but no time as not measured', () => {
    const reading = shapeReading([signal({ at: null })], NOW);
    expect(reading).toMatchObject({ shape: 'unknown', freshness: 'never' });
  });

  it('honours a stale window it is given', () => {
    expect(shapeReading([signal({ at: daysAgo(2) })], NOW, 1).freshness).toBe('stale');
  });
});
