import type { Shape, ShapeReading, ShapeSignal, ShapeSignalId } from '@lupin/shared-contracts';

/**
 * Good shape or bad shape, at any level, from the signals measured there. Pure.
 *
 * - **SHAPE-1:** a signal that was not measured (no shape, or no time) keeps the verdict from
 *   being good. Missing evidence is never a pass.
 * - **SHAPE-2:** evidence older than the stale window keeps the verdict from being good. A stale
 *   bad verdict stays bad: old bad news is still bad news.
 * - **SHAPE-3:** adding a bad signal never improves the verdict.
 */

export const SHAPE_VERSION = 'shape/1';
/** Days after which the newest evidence is stale. */
export const SHAPE_STALE_DAYS = 7;
const DAY = 86_400_000;

export interface ShapeInputSignal {
  id: ShapeSignalId;
  shape: Shape;
  at: Date | null;
  reason: string;
}

const RANK: Readonly<Record<Shape, number>> = { bad: 0, caution: 1, unknown: 2, good: 3 };

const isMeasured = (entry: ShapeInputSignal) => entry.shape !== 'unknown' && entry.at !== null;

function signalOf(entry: ShapeInputSignal): ShapeSignal {
  const measured = isMeasured(entry);
  return {
    id: entry.id,
    shape: measured ? entry.shape : 'unknown',
    at: measured && entry.at !== null ? entry.at.toISOString() : null,
    reason: entry.reason.slice(0, 300),
  };
}

const daysText = (days: number) => `${String(days)} ${days === 1 ? 'day' : 'days'}`;

export function shapeReading(
  input: readonly ShapeInputSignal[],
  now: Date,
  staleDays: number = SHAPE_STALE_DAYS,
): ShapeReading {
  const measured = input.filter(isMeasured);
  const missing = input.filter((entry) => !isMeasured(entry));
  const signals = input.map(signalOf);
  const base = { version: SHAPE_VERSION, signals };
  if (measured.length === 0) {
    return {
      ...base,
      shape: 'unknown',
      freshness: 'never',
      measuredAt: null,
      reason: 'Nothing has been measured yet.',
    };
  }
  const newest = Math.max(...measured.map((entry) => (entry.at as Date).getTime()));
  const age = Math.floor((now.getTime() - newest) / DAY);
  const stale = now.getTime() - newest > staleDays * DAY;
  const worst = [...measured].sort((a, b) => RANK[a.shape] - RANK[b.shape])[0] as ShapeInputSignal;
  const common = {
    ...base,
    freshness: stale ? ('stale' as const) : ('fresh' as const),
    measuredAt: new Date(newest).toISOString(),
  };
  if (worst.shape === 'bad') return { ...common, shape: 'bad', reason: worst.reason };
  if (worst.shape === 'caution') return { ...common, shape: 'caution', reason: worst.reason };
  if (missing.length > 0) {
    return {
      ...common,
      shape: 'caution',
      reason: `Not measured: ${missing.map((entry) => entry.id).join(', ')}.`,
    };
  }
  if (stale) return { ...common, shape: 'caution', reason: `Last measured ${daysText(age)} ago.` };
  return {
    ...common,
    shape: 'good',
    reason: `Every signal was measured in the last ${daysText(staleDays)} and is fine.`,
  };
}

/** The worst of several readings, for a level made of others (the portfolio). */
export function worstReading(readings: readonly ShapeReading[], now: Date): ShapeReading {
  return shapeReading(
    readings.flatMap((reading) =>
      reading.signals.map((entry) => ({
        id: entry.id,
        shape: entry.shape,
        at: entry.at === null ? null : new Date(entry.at),
        reason: entry.reason,
      })),
    ),
    now,
  );
}
