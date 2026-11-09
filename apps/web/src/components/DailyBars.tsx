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
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div role="img" aria-label={summary} className={cn('flex h-24 items-end gap-1', tone)}>
        {days.map((day) => (
          <div
            key={day.date}
            data-testid="daily-bar"
            title={`${shortDate(day.date)}: ${String(day.value)}`}
            className="min-h-px flex-1 rounded-t-sm bg-current opacity-90"
            style={{ height: `${String(Math.round((day.value / peak.value) * 100))}%` }}
          />
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
