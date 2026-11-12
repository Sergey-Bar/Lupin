import React from 'react';
import { GitBranch, cn } from '@lupin/ui';
import { formatDuration, orDash, shortDate } from '../lib/insights.js';
import type { QaInsights } from '../lib/qa.js';
import { Panel, Quiet } from './kit.js';

/** Tests: time to recover, the suites still red, and the pass rate per branch. */
export function RecoveryPanel({ insights }: { insights: QaInsights }): React.ReactElement {
  const { overall, suites } = insights.mttr;
  return (
    <Panel
      title="Recovery and branches"
      scrollLabel="Recovery and branches"
      data-testid="insights-recovery"
      className="flex-1"
      action={<GitBranch size={14} aria-hidden="true" className="text-chart-1" />}
    >
      <div className="flex flex-col gap-3">
        <dl className="m-0 grid shrink-0 grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-fg-muted">Median</dt>
            <dd className="m-0 tabular-nums text-lg font-semibold">
              {orDash(overall.medianMs, formatDuration)}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">p90</dt>
            <dd className="m-0 tabular-nums text-lg font-semibold">
              {orDash(overall.p90Ms, formatDuration)}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Open</dt>
            <dd className="m-0 tabular-nums text-lg font-semibold">
              {String(suites.filter((suite) => suite.openSince !== null).length)}
            </dd>
          </div>
        </dl>
        <ul className="shrink-0 space-y-1 text-xs" aria-label="Suites still failing">
          {suites
            .filter((suite) => suite.openSince !== null)
            .slice(0, 2)
            .map((suite) => (
              <li key={suite.suite} className="flex items-center gap-2 text-danger">
                <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden="true" />
                <span className="truncate font-mono" title={suite.suite}>
                  {suite.suite}
                </span>
                <span className="ms-auto shrink-0">
                  red since {shortDate((suite.openSince ?? '').slice(0, 10))}
                </span>
              </li>
            ))}
        </ul>
        <ul className="space-y-1.5" aria-label="Pass rate by branch">
          {insights.passRateByBranch.length === 0 ? (
            <li>
              <Quiet>No runs in this window.</Quiet>
            </li>
          ) : (
            insights.passRateByBranch.slice(0, 12).map((branch) => (
              <li key={branch.branch} data-testid="branch-row" className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono" title={branch.branch}>
                    {branch.branch}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {orDash(branch.passRate, (value) => `${value.toFixed(1)}%`)} · {branch.runs}{' '}
                    runs
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1 block h-1.5 overflow-hidden rounded-full',
                    branch.passRate === null ? 'bg-surface-muted' : 'bg-chart-fail/30',
                  )}
                >
                  {branch.passRate === null ? null : (
                    <span
                      className="block h-full rounded-full bg-chart-pass"
                      style={{ width: `${String(branch.passRate)}%` }}
                    />
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </Panel>
  );
}
