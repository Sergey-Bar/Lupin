import React from 'react';
import { ExternalLink } from '@lupin/ui';
import type { CockpitWindow } from '@lupin/shared-contracts';
import { useCockpit } from '../hooks/useCockpit.js';
import type { CockpitClient } from '../lib/cockpit-client.js';
import { commitUrl, formatDelta, hasScoreImpact, scoreImpactOf } from '../lib/cockpit-view.js';
import { metricPath } from '../route-manifest.js';
import { safeHref } from './Cockpit.js';

/**
 * "This run is named in the cockpit": the developer's end of the cockpit's three levels.
 *
 * Shown on a run's page only when the person arrived from the cockpit, which the address says
 * (`?from=cockpit`). A run page opened any other way asks the cockpit nothing and shows
 * nothing here, so the page costs what it always cost. When it does ask, it asks the same
 * cockpit for the same window and names the run only if the cockpit does, and says "possibly"
 * for a candidate, because a run recorded while a metric moved is not the reason it moved.
 */
export function ScoreImpactBanner({
  runId,
  commit,
  window,
  projectId,
  getCockpit,
}: {
  runId: string;
  /** The run's commit, as the run records it. */
  commit: string | null;
  window: CockpitWindow;
  /** The run's own project: without it the cockpit shows whichever project reported last. */
  projectId?: string | undefined;
  getCockpit: CockpitClient['getCockpit'];
}): React.ReactElement | null {
  const state = useCockpit(getCockpit, { window, projectId });
  if (state.status !== 'ready') return null;
  const impact = scoreImpactOf(state.value, runId);
  if (!hasScoreImpact(impact)) return null;
  const commitHref = safeHref(commitUrl(state.value, commit));
  return (
    <section
      role="status"
      aria-label="Effect on the score"
      data-testid="score-impact"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
    >
      <p className="font-medium text-fg">The dashboard names this run.</p>
      <ul className="flex flex-col gap-1 text-fg-muted" aria-label="What it is named for">
        {impact.overall ? <li>The overall score changed on this run’s commit.</li> : null}
        {impact.metrics.map((metric) => {
          const change = formatDelta(
            metric.id === 'flaky-tests' ? 'count' : 'percent',
            metric.change,
          );
          return (
            <li key={metric.id}>
              {metric.candidate ? 'Possibly behind ' : 'Behind '}
              <a
                href={metricPath(metric.id, window, state.value.projectId)}
                className="rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                {metric.label}
              </a>
              {change === null ? null : ` (${change})`}
            </li>
          );
        })}
      </ul>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a
          href="/dashboard/now"
          className="rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          Back to the dashboard
        </a>
        {commit === null ? null : commitHref === null ? (
          <span className="font-mono text-xs text-fg-muted">Commit {commit.slice(0, 7)}</span>
        ) : (
          <a
            href={commitHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm font-mono text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            Commit {commit.slice(0, 7)}
            <ExternalLink size={12} aria-hidden="true" />
            <span className="sr-only"> (opens GitHub in a new tab)</span>
          </a>
        )}
      </p>
    </section>
  );
}
