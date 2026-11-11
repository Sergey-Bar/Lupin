import React from 'react';
import type { PaceReport, PaceWeek } from '@lupin/shared-contracts';
import type { Resource } from '../hooks/useResource.js';
import { formatMonthDay, formatNumber } from '../lib/intl.js';
import { Panel } from './kit.js';

/**
 * Whether testing keeps up: the pace headline, the untested-change debt, and one row per week.
 *
 * Every figure is a count of what merged. A week with no tests read says "not measured", and
 * changed lines with no diff coverage are shown as unmeasured — never folded into covered.
 */
export function PacePanel({ pace }: { pace: Resource<PaceReport> }): React.ReactElement {
  return (
    <Panel title="Pace" data-testid="repo-360-pace" scrollLabel="Pace by week">
      {pace.status === 'loading' ? (
        <p className="max-w-measure text-sm text-fg-muted">Reading the pace…</p>
      ) : pace.status === 'error' ? (
        <p role="alert" className="max-w-measure text-sm text-danger">
          The pace could not be read: {pace.message}
        </p>
      ) : (
        <PaceBody report={pace.value} />
      )}
    </Panel>
  );
}

const share = (value: number | null) =>
  value === null ? 'not measured' : `${String(Math.round(value * 100))}%`;

function PaceBody({ report }: { report: PaceReport }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-measure text-sm text-fg">{report.headline}</p>
      {report.status === 'not_configured' ? null : (
        <>
          <dl className="flex flex-wrap gap-6 text-sm">
            <div>
              <dt className="text-xs text-fg-muted">Untested changed lines merged</dt>
              <dd
                className={`font-display text-2xl tabular-nums ${report.debt.uncoveredLines > 0 ? 'text-warning' : 'text-fg'}`}
              >
                {formatNumber(report.debt.uncoveredLines)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Merged with coverage not measured</dt>
              <dd className="font-display text-2xl tabular-nums text-fg">
                {formatNumber(report.debt.unmeasuredLines)}
              </dd>
            </div>
          </dl>
          {report.status === 'insufficient' ? (
            <p className="max-w-measure text-xs text-fg-muted">
              Fewer than two weeks had a merge, so there is no week to compare with yet.
            </p>
          ) : null}
          {report.truncated ? (
            <p className="max-w-measure text-xs text-warning">
              More pull requests merged than were read; every count is a lower bound.
            </p>
          ) : null}
          <WeekTable weeks={report.weeks} />
        </>
      )}
    </div>
  );
}

function WeekTable({ weeks }: { weeks: readonly PaceWeek[] }): React.ReactElement {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Pace by week, oldest first</caption>
      <thead>
        <tr className="text-xs text-fg-muted">
          <th scope="col" className="pe-3 text-start font-medium">
            Week of
          </th>
          <th scope="col" className="pe-3 text-end font-medium">
            Lines
          </th>
          <th scope="col" className="pe-3 text-end font-medium">
            AI
          </th>
          <th scope="col" className="pe-3 text-end font-medium">
            With tests
          </th>
          <th scope="col" className="pe-3 text-end font-medium">
            New tests
          </th>
          <th scope="col" className="text-end font-medium">
            Untested
          </th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week.weekStart} className="tabular-nums">
            <th scope="row" className="pe-3 text-start font-normal text-fg-muted">
              {formatMonthDay(week.weekStart)}
            </th>
            <td className="pe-3 text-end">{formatNumber(week.changedLines)}</td>
            <td className="pe-3 text-end">{share(week.aiShare)}</td>
            <td className="pe-3 text-end">{share(week.testedShare)}</td>
            <td className="pe-3 text-end">
              {week.testsAdded === null ? 'not measured' : formatNumber(week.testsAdded)}
            </td>
            <td className="text-end">{formatNumber(week.uncoveredLines)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
