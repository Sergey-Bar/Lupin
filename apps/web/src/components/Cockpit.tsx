import React from 'react';
import { ExternalLink, Hero, Select, Skeleton, Sparkline, Button, cn } from '@lupin/ui';
import { heroVerdict } from '../lib/hero.js';
import type { ReleaseReadinessCard } from '../lib/qa.js';
import type { Cockpit, CockpitDriver, CockpitMetric, CockpitWindow } from '@lupin/shared-contracts';
import { useCockpit } from '../hooks/useCockpit.js';
import { useCommandActions } from '../hooks/useCommandActions.js';
import { useResource } from '../hooks/useResource.js';
import type { CockpitClient } from '../lib/cockpit-client.js';
import {
  driverText,
  formatDelta,
  formatValue,
  noteOfStatus,
  runDriverHref,
  toneOfStatus,
  trendOfDelta,
  verdictOfStatus,
} from '../lib/cockpit-view.js';
import { metricPath, reportPath } from '../route-manifest.js';
import { AttentionSection, type NowSources } from './Now.js';
import { Delta, PageFrame, PageBody, PageHeader, Panel, Segmented } from './kit.js';
import { StatusLine } from './StatusLine.js';
import { greetingFor } from '../lib/focus.js';
import { isNothingYet } from '../lib/nothing-yet.js';

/**
 * The cockpit: is the product better or worse than it was, and why.
 *
 * One screen, three levels. The headline is for the person who reads one line. The metric
 * cards are for the person who opens one number and wants to know what moved it. The driver
 * under each card is for the developer, who goes from "coverage fell" to the run or the pull
 * request in one click. There is no dashboard per role: the same screen, read to the depth
 * the reader needs.
 *
 * The page never states a change it was not given. A metric the server calls `not_measured`,
 * `no_baseline` or `formula_changed` is shown in words, with no arrow and no colour, so a
 * missing reading cannot be mistaken for a flat one.
 */
export interface CockpitSources {
  /** The projects the person may choose between. */
  projects: () => Promise<ReadonlyArray<{ id: string; name: string }>>;
  attention: NowSources;
  /** The release verdict the hero leads with, for the chosen project; absent, no hero. */
  readiness?: (projectId: string | undefined) => Promise<ReleaseReadinessCard>;
}

const PaceChart = React.lazy(() => import('./CockpitPaceChart.js'));

const WINDOWS: ReadonlyArray<{ value: CockpitWindow; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: 'release', label: 'Since last release' },
];

/** A link to GitHub is followed only if it is an https address; anything else is plain text. */
export function safeHref(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function CockpitPage({
  sources,
  navigate,
  now,
  initialProjectId,
  onProjectChange,
}: {
  sources: CockpitSources;
  navigate: (to: string) => void;
  now?: () => Date;
  /** From the address (?project=), so a link names the project it was about. */
  initialProjectId?: string | undefined;
  /** Told when the person chooses, so the address can follow. */
  onProjectChange?: (projectId: string | undefined) => void;
}): React.ReactElement {
  const [projectId, setProjectId] = React.useState<string | undefined>(initialProjectId);
  return (
    <PageFrame data-testid="cockpit-page" className="gap-4 sm:gap-6">
      <PageHeader
        title={greetingFor((now ?? (() => new Date()))())}
        actions={
          <ProjectPicker
            load={sources.projects}
            value={projectId}
            onChange={(next) => {
              setProjectId(next);
              onProjectChange?.(next);
            }}
          />
        }
      />
      {/* Home is two things: the verdict, then what needs you. The setup line lives in
          Settings and the product's numbers on Health, so nothing here competes with them. */}
      <PageBody>
        {sources.readiness === undefined ? null : (
          <NowHero
            key={projectId ?? ''}
            load={sources.readiness}
            projectId={projectId}
            navigate={navigate}
          />
        )}
        <AttentionSection
          sources={sources.attention}
          navigate={navigate}
          underVerdict={sources.readiness !== undefined}
          {...(now === undefined ? {} : { now })}
        />
      </PageBody>
    </PageFrame>
  );
}

/**
 * How the product is doing: the score, the seven metrics, pace against quality and the report,
 * for a window the reader chooses. Health draws it under Details for the project it is about.
 */
export function CockpitNumbers({
  cockpit,
  projectId,
}: {
  cockpit: CockpitClient['getCockpit'];
  projectId: string | undefined;
}): React.ReactElement {
  const [window, setWindow] = React.useState<CockpitWindow>('7d');
  const [reload, setReload] = React.useState(0);
  useCommandActions([
    {
      id: 'cockpit-window-7d',
      label: 'Numbers: compare with the last 7 days',
      onSelect: () => setWindow('7d'),
    },
    {
      id: 'cockpit-window-release',
      label: 'Numbers: compare since the last release',
      onSelect: () => setWindow('release'),
    },
  ]);
  return (
    <div data-testid="cockpit-numbers" className="flex flex-col gap-4">
      <Segmented<CockpitWindow>
        label="Compare with"
        options={WINDOWS}
        value={window}
        onChange={setWindow}
      />
      {/* Keyed by the window and the reload, so a new read starts from loading and never
          shows the previous window's headline under the new window's label. */}
      <CockpitReading
        key={`${projectId ?? ''}:${window}:${String(reload)}`}
        cockpit={cockpit}
        window={window}
        projectId={projectId}
        onRetry={() => setReload((count) => count + 1)}
      />
    </div>
  );
}

function CockpitReading({
  cockpit: load,
  window,
  projectId,
  onRetry,
}: {
  cockpit: CockpitClient['getCockpit'];
  window: CockpitWindow;
  projectId: string | undefined;
  onRetry: () => void;
}): React.ReactElement {
  const state = useCockpit(load, { window, projectId });
  // The chart is the heaviest part of the page and the last thing a reader needs, so it
  // loads after the headline and the cards have painted.
  const [chartReady, setChartReady] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setChartReady(true), 0);
    return () => clearTimeout(timer);
  }, []);

  if (state.status === 'loading') {
    return (
      <div
        data-testid="cockpit-loading"
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
    // A bare "not found" from the server is not a sentence a reader can act on. Here it means
    // nothing has reported yet, so say that and give the one next step. Any other server
    // sentence is shown as the server wrote it.
    const nothingYet = isNothingYet(state.message);
    return (
      <div
        role="alert"
        data-testid="cockpit-error"
        className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-5"
      >
        {nothingYet ? (
          <>
            <p className="text-sm font-medium text-fg">No project has sent results yet.</p>
            <p className="text-sm text-fg-muted">
              The cockpit fills in after a repository is connected and its first run arrives.
            </p>
            <a
              href="/dashboard/setup"
              className="text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Set up Lupin
            </a>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-fg">The cockpit could not be read.</p>
            <p className="text-sm text-fg-muted">{state.message}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </>
        )}
      </div>
    );
  }
  const cockpit = state.value;
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <Headline cockpit={cockpit} />
      <p className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
        <span data-testid="cockpit-scope">
          {cockpit.projectName} · {cockpit.branch}
        </span>
        <a
          href={reportPath(cockpit.projectId, window)}
          data-testid="cockpit-report"
          className="inline-flex min-h-6 items-center rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          Download report
          <span className="sr-only"> as one HTML file that opens without an account</span>
        </a>
      </p>
      <ul
        aria-label="Metrics"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {cockpit.metrics.map((metric) => (
          <MetricCard
            key={metric.id}
            metric={metric}
            window={window}
            projectId={cockpit.projectId}
          />
        ))}
      </ul>
      <RiskSection risks={cockpit.risks} />
      <Panel title="Pace against quality">
        {chartReady ? (
          <React.Suspense fallback={<Skeleton className="h-44 w-full" />}>
            <PaceChart pace={cockpit.pace} />
          </React.Suspense>
        ) : (
          <Skeleton className="h-44 w-full" />
        )}
      </Panel>
    </div>
  );
}

/**
 * Pull requests worth a person's look, each with the one fact that put it here. Not a score:
 * with nothing matched the section says so, and says what it reads, so an empty list is not
 * mistaken for a clean bill of health on a project whose pull requests were never synced.
 */
function RiskSection({ risks }: { risks: Cockpit['risks'] }): React.ReactElement {
  return (
    <Panel title="Worth a look" data-testid="cockpit-risks">
      {risks.total === 0 ? (
        <p className="text-sm text-fg-muted">
          No pull request matched. This reads synced pull requests only; if none are synced, nothing
          was checked.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {risks.items.map((item) => {
              const href = safeHref(item.url);
              const name = `#${String(item.number)} ${item.title}`;
              return (
                <li
                  key={`${item.kind}:${String(item.number)}`}
                  className="flex flex-col gap-0.5 border-t border-border pt-2 text-sm"
                >
                  {href === null ? (
                    <span className="text-fg">{name}</span>
                  ) : (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      {name}
                      <ExternalLink size={12} aria-hidden="true" />
                      <span className="sr-only"> (opens GitHub in a new tab)</span>
                    </a>
                  )}
                  <span className="text-xs text-fg-muted">{item.detail}</span>
                </li>
              );
            })}
          </ul>
          {risks.total > risks.items.length ? (
            <p className="mt-2 text-xs text-fg-muted">
              Showing the newest {risks.items.length} of {risks.total}.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/**
 * Chooses which project the cockpit is about. Hidden when there is nothing to choose between,
 * and when the list cannot be read: the cockpit still opens on the project that reported last,
 * which is what it did before there was a choice. "Latest report" names that default plainly.
 */
function ProjectPicker({
  load,
  value,
  onChange,
}: {
  load: CockpitSources['projects'];
  value: string | undefined;
  onChange: (projectId: string | undefined) => void;
}): React.ReactElement | null {
  const state = useResource(() => load(), [load]);
  if (state.status !== 'ready' || state.value.length < 2) return null;
  const known = state.value.some((project) => project.id === value);
  return (
    <div className="w-56" data-testid="cockpit-project">
      <Select
        id="cockpit-project-select"
        label="Project"
        value={known ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        options={[
          { value: '', label: 'Latest report' },
          ...state.value.map((project) => ({ value: project.id, label: project.name })),
        ]}
      />
    </div>
  );
}

function Headline({ cockpit }: { cockpit: Cockpit }): React.ReactElement {
  const href = safeHref(cockpit.overall.drivers[0]?.url ?? null);
  return (
    <StatusLine
      data-testid="cockpit-status"
      value={formatValue('score', cockpit.overall.score)}
      tone={toneOfStatus(cockpit.overall.status)}
      sentence={cockpit.headline}
      action={href === null ? undefined : { label: 'See the change', href }}
    />
  );
}

const SPARK_TONE: Partial<Record<CockpitMetric['status'], string>> = {
  improved: 'text-success',
  worse: 'text-danger',
};

function MetricCard({
  metric,
  window,
  projectId,
}: {
  metric: CockpitMetric;
  window: CockpitWindow;
  projectId: string;
}): React.ReactElement {
  const moved = metric.status === 'improved' || metric.status === 'worse';
  const note = noteOfStatus(metric.status);
  const delta = formatDelta(metric.unit, metric.delta);
  const value = formatValue(metric.unit, metric.value);
  return (
    <li
      data-testid={`cockpit-metric-${metric.id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">
          <a
            href={metricPath(metric.id, window, projectId)}
            className="inline-flex min-h-6 items-center rounded-sm text-fg-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {metric.label}
            <span className="sr-only">, open details</span>
          </a>
        </h3>
        {metric.series.length === 0 ? null : (
          <Sparkline
            points={metric.series.map((point) => point.value)}
            label={`${metric.label} over time`}
            value={value}
            {...(trendOfDelta(metric.delta) === undefined
              ? {}
              : { trend: trendOfDelta(metric.delta) as 'up' | 'down' | 'flat' })}
            tone={SPARK_TONE[metric.status] ?? 'text-fg-muted'}
          />
        )}
      </div>
      <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      {moved && delta !== null ? (
        <Delta
          text={delta}
          verdict={verdictOfStatus(metric.status)}
          rising={(metric.delta as number) > 0}
        />
      ) : (
        <p className="text-xs text-fg-muted">{note}</p>
      )}
      {metric.drivers.length === 0 ? null : (
        <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
          {metric.drivers.map((driver, index) => (
            <Driver
              key={`${driver.kind}:${driver.ref ?? 'none'}:${String(index)}`}
              driver={driver}
              window={window}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function Driver({
  driver,
  window,
}: {
  driver: CockpitDriver;
  window: CockpitWindow;
}): React.ReactElement {
  const href = safeHref(driver.url);
  const inside = runDriverHref(driver, window);
  const text = driverText(driver);
  return (
    <p className={cn('text-xs', driver.kind === 'unknown' ? 'text-fg-muted' : 'text-fg')}>
      {inside !== null ? (
        <a
          href={inside}
          className="inline-flex min-h-6 items-center rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {text}
        </a>
      ) : href === null ? (
        text
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {text}
          <ExternalLink size={12} aria-hidden="true" />
          <span className="sr-only"> (opens GitHub in a new tab)</span>
        </a>
      )}
    </p>
  );
}

/**
 * The release verdict, full width at the top of Now: the word, the reason, and the one place
 * to go. While it loads the space is held, so the page does not jump when it lands.
 */
function NowHero({
  load,
  projectId,
  navigate,
}: {
  load: (projectId: string | undefined) => Promise<ReleaseReadinessCard>;
  projectId: string | undefined;
  navigate: (to: string) => void;
}): React.ReactElement {
  const card = useResource(() => load(projectId), [load, projectId]);
  if (card.status === 'loading') return <Skeleton className="h-64 w-full" />;
  const hero = heroVerdict(card.status === 'ready' ? card.value : null);
  return (
    <Hero
      headingLevel={2}
      verdict={hero.verdict}
      word={hero.word}
      reason={
        card.status === 'error'
          ? `Lupin could not read the release gates (${card.message.replace(/\.$/u, '')}).`
          : hero.reason
      }
      eyebrow="Release readiness"
    >
      <div>
        {/* Secondary: the focus card below owns the one primary fill on the page. */}
        <Button variant="secondary" className="min-h-11" onClick={() => navigate(hero.action.to)}>
          {hero.action.label}
        </Button>
      </div>
    </Hero>
  );
}
