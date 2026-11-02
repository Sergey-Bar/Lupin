/**
 * Every number and date the dashboard prints goes through here.
 *
 * It replaced `'en-US'` literals in three files and a browser-locale `toLocaleString()` in a
 * fourth, which made the same page read in two conventions at once. The interface is English;
 * one place decides how an English reader sees a count or a date.
 */
const TAG = 'en-US';

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString(TAG);
}

/** Up to one decimal place. */
export function formatPlain(value: number): string {
  return new Intl.NumberFormat(TAG, { maximumFractionDigits: 1 }).format(value);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat(TAG, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/** `2026-10-20` as a short month and day, in UTC so the label matches the bucket it names. */
export function formatMonthDay(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(TAG, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * A date and time that names its zone. The wording follows the reader's browser (`25/09/2026`
 * against `9/25/2026` is their convention, as `format.ts` explains); the zone is what changes
 * what a timestamp means, so it is always shown.
 */
export function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, { timeZoneName: 'short' });
}

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/**
 * "3 days ago", in the largest unit that fits. Less than a minute either way is "now". A value
 * that is not a time is the empty string, never a sentence about an invalid date.
 */
export function formatRelative(iso: string, now: Date): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const delta = at - now.getTime();
  const format = new Intl.RelativeTimeFormat(TAG, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) return format.format(Math.round(delta / size), unit);
  }
  return format.format(0, 'second');
}
