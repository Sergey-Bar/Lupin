import React from 'react';
import { cn } from '@lupin/ui';
import { shortDate } from '../lib/insights.js';

/**
 * One count per day, as bars scaled to the busiest day.
 *
 * HTML bars rather than SVG: a column of `div`s scales with the panel and keeps its text
 * crisp, and there is no second axis to align. The shape is said once in words for a screen
 * reader, and every number is in a visually hidden table beneath. A window with none says so
 * instead of drawing an empty strip that reads as "no data".
 */
export function DailyBars({
  days,
  label,
  tone,
}: {
  days: readonly { date: string; value: number }[];
  label: string;
  /** A chart token text class, e.g. `text-chart-flaky`; the bars draw in `currentColor`. */
  tone: string;
}): React.ReactElement {
  const total = days.reduce((sum, day) => sum + day.value, 0);
  if (total === 0) return <p className="text-sm text-fg-muted">None in this window.</p>;
  const peak = days.reduce((best, day) => (day.value > best.value ? day : best));
  const summary = `${label}: ${String(total)} over ${String(days.length)} days, most on ${shortDate(peak.date)} (${String(peak.value)}).`;
  // No chart without a comparison: the recent half of the window against the half before it.
  // A count of failures, so more is worse.
  const half = Math.floor(days.length / 2);
  const sum = (part: readonly { value: number }[]) => part.reduce((s, day) => s + day.value, 0);
  const recent = sum(days.slice(days.length - half));
  const before = sum(days.slice(days.length - 2 * half, days.length - half));
  const change = recent - before;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div role="img" aria-label={summary} className={cn('flex h-28 items-end gap-1 pt-5', tone)}>
        {days.map((day) => (
          <div key={day.date} className="relative flex h-full flex-1 flex-col justify-end">
            {day === peak ? (
              <span
                data-testid="daily-peak"
                aria-hidden="true"
                className="absolute inset-x-0 mb-1 text-center text-xs font-medium tabular-nums text-fg"
                style={{ bottom: `${String(Math.round((day.value / peak.value) * 100))}%` }}
              >
                {String(day.value)}
              </span>
            ) : null}
            {day.value === 0 ? (
              // A day with none still has its place: a stub on the baseline, not a gap.
              <div
                data-testid="daily-bar"
                data-empty="true"
                title={`${shortDate(day.date)}: 0`}
                className="h-0.5 rounded-full bg-border-strong"
              />
            ) : (
              <div
                data-testid="daily-bar"
                title={`${shortDate(day.date)}: ${String(day.value)}`}
                className="min-h-0.5 rounded-t-sm bg-current opacity-90"
                style={{ height: `${String(Math.round((day.value / peak.value) * 100))}%` }}
              />
            )}
          </div>
        ))}
      </div>
      <figcaption
        aria-hidden="true"
        className="flex justify-between text-xs tabular-nums text-fg-muted"
      >
        <span>{shortDate(days[0]?.date ?? peak.date)}</span>
        <span>
          {String(total)} total · peak {String(peak.value)}
        </span>
        <span>{shortDate(days.at(-1)?.date ?? peak.date)}</span>
      </figcaption>
      {half === 0 ? null : (
        <p data-testid="daily-compare" className="text-xs text-fg-muted">
          {String(recent)} in the last {String(half)} days, vs {String(before)} in the{' '}
          {String(half)} before{' '}
          <span
            className={cn(
              'font-medium',
              change > 0 ? 'text-danger' : change < 0 ? 'text-success' : 'text-fg-muted',
            )}
          >
            {change > 0 ? '+' : change < 0 ? '−' : '±'}
            {String(Math.abs(change))}
          </span>
        </p>
      )}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{day.date}</th>
                <td>{day.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
