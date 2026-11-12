import { formatDateTime } from './intl.js';

/**
 * Date rendering shared by the dashboard routes.
 *
 * The fallback is a required parameter rather than an option with a default. The
 * three definitions this replaced rendered `'Not started'` on the runs list and
 * `'UNKNOWN'` on run detail, and those are different claims: one says the run
 * never began, the other says the field is unknown. A default would have picked
 * one of them silently and turned a refactor into a product change.
 *
 * **The rendered time names its time zone.** `toLocaleString()` renders in the
 * viewer's zone and says nothing about it, so the same run reads as `13:30` in
 * Tel Aviv and `12:30` in Berlin, and a reader comparing it against a CI log in
 * UTC has no way to tell which is right (ledger W-7a). Both readings look correct
 * to the person who produced each, which is what made the discrepancy invisible.
 *
 * The zone is appended rather than the whole format being rebuilt, because the
 * *wording* is genuinely locale-dependent — `25/09/2026` against `9/25/2026` is
 * the reader's own convention and not a defect — while the *zone* is the part
 * that changes what a timestamp means.
 */
export function formatDate(value: string | null | undefined, emptyState: string): string {
  if (!value) return emptyState;
  const date = new Date(value);
  // `new Date('not a date').toLocaleString()` is the literal string "Invalid Date",
  // which is neither a time nor the caller's claim about the field — so an
  // unparseable value falls back rather than rendering a sentence about a date.
  if (Number.isNaN(date.getTime())) return emptyState;
  return formatDateTime(date);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * A size a person can read: `1.5 KB`, `50 MB`. Binary steps (1 KB is 1,024 bytes), one
 * decimal below ten and none above, the way a file manager shows it (ledger MNT-190).
 */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  const text = new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(value);
  return `${text} ${BYTE_UNITS[unit] ?? 'B'}`;
}
