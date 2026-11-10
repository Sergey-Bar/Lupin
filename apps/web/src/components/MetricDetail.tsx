import React from 'react';
import {
  ExternalLink,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lupin/ui';
import {
  CockpitMetricIdSchema,
  type Cockpit,
  type CockpitDriver,
  type CockpitMetric,
  type CockpitWindow,
} from '@lupin/shared-contracts';
import { useCockpit } from '../hooks/useCockpit.js';
import type { CockpitClient } from '../lib/cockpit-client.js';
import {
  SERIES_HEIGHT,
  SERIES_LAYOUT,
  SERIES_WIDTH,
  deeperLinks,
  driverText,
  formatDelta,
  formatValue,
  noteOfStatus,
  runDriverHref,
  seriesGeometry,
  verdictOfStatus,
} from '../lib/cockpit-view.js';
import { cockpitPath } from '../route-manifest.js';
import { safeHref } from './Cockpit.js';
import { Delta, PageFrame, PageBody, PageHeader, Panel, Segmented } from './kit.js';

/**
 * One metric, one level down: the level a QA engineer or SDET opens a card to reach.
 *
 * The cockpit says that coverage fell. This page says by how much, over which readings,
 * which runs were recorded while it fell, and where to go to do something about it: the
 * gaps behind coverage, the flaky tests and quarantine behind the flaky count. Those pages
 * are not copied here. They stay where they were, and this page is how a person reaches
 * them in the context of the number that sent them.
 *
 * The same rule as the cockpit holds: a change that was not measured, had no baseline or
 * crossed a formula change is said in words and is never drawn as a movement.
 */
export interface MetricSources {
  cockpit: CockpitClient['getCockpit'];
}

const WINDOWS: ReadonlyArray<{ value: CockpitWindow; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: 'release', label: 'Since last release' },
];

const KIND_LABEL: Record<CockpitDriver['kind'], string> = {
  pull_request: 'Pull request',
  run: 'Run',
  commit: 'Commit',
  unknown: 'Cause unknown',
};

export function MetricDetailPage({
  metricId,
  initialWindow = '7d',
  projectId,
  sources,
}: {
  metricId: string;
  initialWindow?: CockpitWindow;
  /** The project the cockpit was showing; without one, the one that reported last. */
  projectId?: string | undefined;
  sources: MetricSources;
}): React.ReactElement {
  const parsed = CockpitMetricIdSchema.safeParse(metricId);
  const [window, setWindow] = React.useState<CockpitWindow>(initialWindow);
  if (!parsed.success) {
    return (
      <PageFrame data-testid="metric-unknown" className="gap-4">
        <PageHeader title="Unknown metric" subtitle={<BackToCockpit projectId={projectId} />} />
        <PageBody>
          <p className="text-sm text-fg-muted">
            The dashboard has no metric called “{metricId.slice(0, 60)}”. Open one from the
            dashboard.
          </p>
        </PageBody>
      </PageFrame>
    );
  }
  return (
    <PageFrame data-testid="metric-page" className="gap-4 sm:gap-6">
      <PageHeader
        title={LABELS[parsed.data]}
        subtitle={<BackToCockpit projectId={projectId} />}
        actions={
          <Segmented<CockpitWindow>
            label="Compare with"
            options={WINDOWS}
            value={window}
            onChange={setWindow}
          />
        }
      />
      <PageBody>
        {/* Keyed by the window so a new read starts from loading, as the cockpit does. */}
        <MetricReading
          key={window}
          metricId={parsed.data}
          window={window}
          projectId={projectId}
          sources={sources}
        />
      </PageBody>
    </PageFrame>
  );
}

const LABELS: Record<CockpitMetric['id'], string> = {
  security: 'Security',
  tests: 'Tests',
  'code-quality': 'Code quality',
  dependencies: 'Dependencies',
  coverage: 'Coverage',
  'flaky-tests': 'Flaky tests',
  'run-pass-rate': 'Run pass rate',
};

function BackToCockpit({ projectId }: { projectId?: string | undefined }): React.ReactElement {
  return (
    <a
      href={cockpitPath(projectId)}
      className="rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      Back to the dashboard
    </a>
  );
}

function MetricReading({
  metricId,
  window,
  projectId,
  sources,
}: {
  metricId: CockpitMetric['id'];
  window: CockpitWindow;
  projectId: string | undefined;
  sources: MetricSources;
}): React.ReactElement {
  const state = useCockpit(sources.cockpit, { window, projectId });
  if (state.status === 'loading') {
    return (
      <div
        data-testid="metric-loading"
        role="status"
        aria-label="Loading"
        aria-busy="true"
        className="flex flex-col gap-4"
      >
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div
        role="alert"
        data-testid="metric-error"
        className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5"
      >
        <p className="text-sm font-medium text-fg">This metric could not be read.</p>
        <p className="text-sm text-fg-muted">{state.message}</p>
      </div>
    );
  }
  const cockpit = state.value;
  const metric = cockpit.metrics.find((candidate) => candidate.id === metricId);
  if (metric === undefined) {
    return (
      <p data-testid="metric-missing" className="text-sm text-fg-muted">
        The dashboard did not report this metric for {cockpit.projectName}.
      </p>
    );
  }
  return <MetricBody cockpit={cockpit} metric={metric} window={window} />;
}

function MetricBody({
  cockpit,
  metric,
  window,
}: {
  cockpit: Cockpit;
  metric: CockpitMetric;
  window: CockpitWindow;
}): React.ReactElement {
  const moved = metric.status === 'improved' || metric.status === 'worse';
  const delta = formatDelta(metric.unit, metric.delta);
  const note = noteOfStatus(metric.status);
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <p className="-mt-2 text-sm text-fg-muted" data-testid="metric-scope">
        {cockpit.projectName} · {cockpit.branch}
      </p>
      <section
        aria-label="Summary"
        data-testid="metric-summary"
        className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5"
      >
        <p className="text-5xl font-semibold tabular-nums tracking-tight">
          {formatValue(metric.unit, metric.value)}
        </p>
        {moved && delta !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Delta
              text={delta}
              verdict={verdictOfStatus(metric.status)}
              rising={(metric.delta as number) > 0}
            />
            <span className="text-sm text-fg-muted">
              from {formatValue(metric.unit, metric.baseline)} at the start of the window
            </span>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{note}</p>
        )}
      </section>
      <Panel title="Readings">
        <SeriesChart metric={metric} />
      </Panel>
      <Panel title="What moved it">
        <Drivers metric={metric} window={window} moved={moved} />
      </Panel>
      <Panel title="Go deeper">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Pages that go deeper">
          {deeperLinks(metric.id, cockpit.projectId).map((link) => (
            <li key={link.to}>
              <a
                href={link.to}
                className="flex min-h-11 flex-col rounded-lg border border-border p-3 no-underline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                <span className="text-sm font-medium text-fg">{link.label}</span>
                <span className="text-xs text-fg-muted">{link.description}</span>
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function SeriesChart({ metric }: { metric: CockpitMetric }): React.ReactElement {
  const geometry = React.useMemo(() => seriesGeometry(metric.series), [metric.series]);
  if (geometry.dots.length === 0) {
    return (
      <p data-testid="metric-no-readings" className="text-sm text-fg-muted">
        No readings yet. A reading is recorded when a scan or an upload reaches the server.
      </p>
    );
  }
  const left = SERIES_LAYOUT.padX;
  const right = SERIES_WIDTH - SERIES_LAYOUT.padX;
  const top = SERIES_LAYOUT.padTop;
  const bottom = SERIES_HEIGHT - SERIES_LAYOUT.padBottom;
  return (
    <figure className="flex flex-col gap-3" data-testid="metric-series">
      <svg
        viewBox={`0 0 ${String(SERIES_WIDTH)} ${String(SERIES_HEIGHT)}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${metric.label}: ${String(geometry.dots.length)} readings from ${formatValue(metric.unit, geometry.dots[0]?.value ?? null)} to ${formatValue(metric.unit, geometry.dots.at(-1)?.value ?? null)}. The table below has the readings.`}
        focusable="false"
      >
        <line x1={left} x2={right} y1={bottom} y2={bottom} className="stroke-chart-grid" />
        <line x1={left} x2={right} y1={top} y2={top} className="stroke-chart-grid" />
        <text x={left - 6} y={top + 4} fontSize={10} textAnchor="end" className="fill-fg-muted">
          {formatValue(metric.unit, geometry.max)}
        </text>
        <text x={left - 6} y={bottom} fontSize={10} textAnchor="end" className="fill-fg-muted">
          {formatValue(metric.unit, geometry.min)}
        </text>
        {geometry.path === null ? null : (
          <path
            d={geometry.path}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-chart-line"
          />
        )}
        {geometry.dots.map((dot) => (
          <circle key={dot.at} cx={dot.x} cy={dot.y} r={2.5} className="fill-chart-line" />
        ))}
        <text x={left} y={SERIES_HEIGHT - 8} fontSize={10} className="fill-fg-muted">
          {geometry.firstAt?.slice(0, 10)}
        </text>
        <text
          x={right}
          y={SERIES_HEIGHT - 8}
          fontSize={10}
          textAnchor="end"
          className="fill-fg-muted"
        >
          {geometry.lastAt?.slice(0, 10)}
        </text>
      </svg>
      <figcaption className="sr-only">The readings of {metric.label}, oldest first.</figcaption>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recorded</TableHead>
            <TableHead className="text-end">{metric.label}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...metric.series].reverse().map((point) => (
            <TableRow key={point.at}>
              <TableCell className="tabular-nums">
                {point.at.slice(0, 16).replace('T', ' ')}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatValue(metric.unit, point.value)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </figure>
  );
}

function Drivers({
  metric,
  window,
  moved,
}: {
  metric: CockpitMetric;
  window: CockpitWindow;
  moved: boolean;
}): React.ReactElement {
  if (metric.drivers.length === 0) {
    return (
      <p data-testid="metric-no-drivers" className="text-sm text-fg-muted">
        {moved
          ? 'Nothing recorded says what moved this.'
          : 'It did not move, so there is nothing to explain.'}
      </p>
    );
  }
  const anyCandidate = metric.drivers.some((driver) => driver.candidate);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" aria-label="Drivers">
        {metric.drivers.map((driver, index) => (
          <DriverRow
            key={`${driver.kind}:${driver.ref ?? 'none'}:${String(index)}`}
            driver={driver}
            metric={metric}
            window={window}
          />
        ))}
      </ul>
      {anyCandidate ? (
        <p className="text-xs text-fg-muted" data-testid="metric-candidate-note">
          These runs were recorded while this metric changed. It is read hourly and carries no
          commit, so none of them is named as the cause.
        </p>
      ) : null}
    </div>
  );
}

function DriverRow({
  driver,
  metric,
  window,
}: {
  driver: CockpitDriver;
  metric: CockpitMetric;
  window: CockpitWindow;
}): React.ReactElement {
  const change = formatDelta(metric.unit, driver.change);
  // A run is a page of this product; a pull request or a commit is GitHub's.
  const internal = runDriverHref(driver, window);
  const external = safeHref(driver.url);
  const text = driverText(driver);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="text-xs text-fg-muted">{KIND_LABEL[driver.kind]}</p>
        <p className="text-sm text-fg">
          {internal !== null ? (
            <a
              href={internal}
              className="rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              {text}
            </a>
          ) : external !== null ? (
            <a
              href={external}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              {text}
              <ExternalLink size={12} aria-hidden="true" />
              <span className="sr-only"> (opens GitHub in a new tab)</span>
            </a>
          ) : (
            text
          )}
        </p>
      </div>
      <div className="flex items-center gap-3 text-xs text-fg-muted tabular-nums">
        {change === null ? null : <span>{change}</span>}
        {driver.at === null ? null : <span>{driver.at.slice(0, 10)}</span>}
      </div>
    </li>
  );
}
