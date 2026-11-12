import React from 'react';
import { ExternalLink, Hero, Skeleton, Sparkline, StatusDot, Button, cn } from '@lupin/ui';
import { heroVerdict } from '../lib/hero.js';
import type { QaInsights, ReleaseReadinessCard } from '../lib/qa.js';
import type {
  BriefingResponse,
  Cockpit,
  CockpitDriver,
  CockpitMetric,
  CockpitWindow,
} from '@lupin/shared-contracts';
import { BriefingCard } from './Briefing.js';
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
import { FailureClustersPanel } from './InsightsCauses.js';
import { ReadFailed } from './ReadFailed.js';
import { RiskSection } from './CockpitRisks.js';
import { ReleaseSignoffPanel, type SignoffSource } from './ReleaseSignoff.js';
import { DailyBars } from './DailyBars.js';

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
  attention: NowSources;
  /** The release verdict the hero leads with, for the chosen project; absent, no hero. */
  readiness?: (projectId: string | undefined) => Promise<ReleaseReadinessCard>;
  /** Failures grouped by root cause, for the Triage view; absent, Triage lists what needs you only. */
  clusters?: (projectId: string | undefined) => Promise<QaInsights['failureClusters']>;
  /** Failed results per day, for the Release view's trend; absent, Release shows the reasons only. */
  trend?: (
    projectId: string | undefined,
  ) => Promise<ReadonlyArray<{ date: string; failed: number }>>;
  /** What happened over the last week, for the Release view's card; absent, no card. */
  briefing?: (projectId: string | undefined) => Promise<BriefingResponse>;
  /** Release sign-off for the chosen project; absent, or with no project chosen, none drawn. */
  signoff?: SignoffSource;
}

/** Which Home a reader opens on: Triage for the engineer, Release for the lead. Kept per browser. */
export const HOME_VIEW_KEY = 'lupin-home-view';
type HomeView = 'triage' | 'release';
const HOME_VIEWS: ReadonlyArray<{ value: HomeView; label: string }> = [
  { value: 'triage', label: 'Triage' },
  { value: 'release', label: 'Release' },
];
function readHomeView(): HomeView {
  try {
    return localStorage.getItem(HOME_VIEW_KEY) === 'release' ? 'release' : 'triage';
  } catch {
    return 'triage';
  }
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
  projectId,
}: {
  sources: CockpitSources;
  navigate: (to: string) => void;
  now?: () => Date;
  /**
   * The project scope, chosen in the sidebar (`useScope`); `undefined` is every project, where
   * the verdict is the latest report's. Home has no picker of its own.
   */
  projectId?: string | undefined;
}): React.ReactElement {
  const [view, setView] = React.useState<HomeView>(readHomeView);
  const choose = (next: HomeView) => {
    setView(next);
    try {
      localStorage.setItem(HOME_VIEW_KEY, next);
    } catch {
      // A storage that refuses writes keeps the choice for this page only.
    }
  };
  return (
    <PageFrame data-testid="cockpit-page" className="gap-4 sm:gap-6">
      <PageHeader
        visibleTitle
        title={greetingFor((now ?? (() => new Date()))())}
        actions={
          <Segmented<HomeView>
            label="Home view"
            options={HOME_VIEWS}
            value={view}
            onChange={choose}
          />
        }
      />
      {/* Home is two things: the verdict, then what needs you. The setup line lives in
          Settings and the product's numbers on Health, so nothing here competes with them. */}
      <PageBody>
        {/* Release: the decision for a lead. Triage: what needs you, then failures by cause. */}
        {sources.readiness === undefined ? null : (
          <NowHero
            key={projectId ?? ''}
            load={sources.readiness}
            projectId={projectId}
            navigate={navigate}
          />
        )}
        {sources.signoff === undefined || projectId === undefined ? null : (
          <ReleaseSignoffPanel source={sources.signoff} projectId={projectId} />
        )}
        {view === 'release' ? null : (
          <AttentionSection
            sources={sources.attention}
            navigate={navigate}
            underVerdict={sources.readiness !== undefined}
            {...(now === undefined ? {} : { now })}
          />
        )}
        {view === 'triage' && sources.clusters !== undefined ? (
          <TriageCauses key={projectId ?? ''} load={sources.clusters} projectId={projectId} />
        ) : null}
        {view === 'release' && sources.readiness !== undefined ? (
          <ReleaseReasons key={projectId ?? ''} load={sources.readiness} projectId={projectId} />
        ) : null}
        {view === 'release' && sources.briefing !== undefined ? (
          <HomeBriefing
            key={`briefing-${projectId ?? ''}`}
            load={sources.briefing}
            projectId={projectId}
          />
        ) : null}
        {view === 'release' && sources.trend !== undefined ? (
          <ReleaseTrend
            key={`trend-${projectId ?? ''}`}
            load={sources.trend}
            projectId={projectId}
          />
        ) : null}
      </PageBody>
    </PageFrame>
  );
}

/**
 * Release: what happened over the last week, so a lead coming back reads it before deciding.
 * Read on its own, so a slow briefing never holds the verdict back.
 */
function HomeBriefing({
  load,
  projectId,
}: {
  load: NonNullable<CockpitSources['briefing']>;
  projectId: string | undefined;
}): React.ReactElement {
  const read = useResource(() => load(projectId), [load, projectId]);
  return <BriefingCard read={read} projectId={projectId} />;
}

/**
 * Release: is the risk rising or falling? Failed results per day over the window, with the
 * recent half against the half before it, so a lead sees the direction and not only today.
 */
function ReleaseTrend({
  load,
  projectId,
}: {
  load: NonNullable<CockpitSources['trend']>;
  projectId: string | undefined;
}): React.ReactElement {
  const days = useResource(() => load(projectId), [load, projectId]);
  if (days.status === 'loading') return <Skeleton className="h-32 w-full" />;
  if (days.status === 'error') return <ReadFailed failure={days} />;
  return (
    <Panel title="Failed results per day, every project" data-testid="release-trend">
      <DailyBars
        days={days.value.map((day) => ({ date: day.date, value: day.failed }))}
        label="Failed results per day"
        tone="text-chart-fail"
      />
    </Panel>
  );
}

/**
 * Release: every reason behind the decision, worst first, so a lead reads the whole case for
 * go or no-go on one screen. Passing gates are left out; the band already says what holds.
 */
function ReleaseReasons({
  load,
  projectId,
}: {
  load: NonNullable<CockpitSources['readiness']>;
  projectId: string | undefined;
}): React.ReactElement {
  const card = useResource(() => load(projectId), [load, projectId]);
  if (card.status === 'loading') return <Skeleton className="h-32 w-full" />;
  if (card.status === 'error') return <ReadFailed failure={card} />;
  const RANK: Record<string, number> = { 'no-go': 0, caution: 1, unknown: 2 };
  const reasons = card.value.reasons
    .filter((reason) => reason.level !== 'go')
    .sort((a, b) => (RANK[a.level] ?? 3) - (RANK[b.level] ?? 3));
  return (
    <Panel title="Why this decision">
      {reasons.length === 0 ? (
        <p className="text-sm text-fg-muted">Every release gate passes.</p>
      ) : (
        <ul aria-label="Why this decision" className="flex flex-col gap-2">
          {reasons.map((reason) => (
            <li key={reason.code} className="flex items-center gap-3 text-sm text-fg">
              <StatusDot
                status={
                  reason.level === 'no-go' ? 'bad' : reason.level === 'caution' ? 'warn' : 'unknown'
                }
              />
              {reason.message}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Failures grouped by root cause, Sentry-style: one row per cause, biggest first. */
function TriageCauses({
  load,
  projectId,
}: {
  load: NonNullable<CockpitSources['clusters']>;
  projectId: string | undefined;
}): React.ReactElement {
  const clusters = useResource(() => load(projectId), [load, projectId]);
  if (clusters.status === 'loading') return <Skeleton className="h-40 w-full" />;
  if (clusters.status === 'error') return <ReadFailed failure={clusters} />;
  return <FailureClustersPanel clusters={clusters.value} className="" />;
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
              The dashboard fills in after a repository is connected and its first run arrives.
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
            <p className="text-sm font-medium text-fg">The dashboard could not be read.</p>
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
