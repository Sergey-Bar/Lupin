import type {
  Cockpit,
  CockpitDriver,
  CockpitMetric,
  CockpitMetricId,
  CockpitPaceWeek,
  CockpitStatus,
  CockpitWindow,
} from '@lupin/shared-contracts';
import { runDetailPath } from '../route-manifest.js';
import type { Verdict } from './insights.js';

/**
 * How the cockpit payload is read aloud and drawn.
 *
 * Pure: no React, no clock. The payload already says what changed and whether it can be
 * compared; this file decides only the words and the geometry, so a screen cannot disagree
 * with the server about whether a number moved. Anything the server says is `not_measured`,
 * `no_baseline` or `formula_changed` stays that, in words, and is never drawn as a change.
 */

export function verdictOfStatus(status: CockpitStatus): Verdict {
  switch (status) {
    case 'improved':
      return 'better';
    case 'worse':
      return 'worse';
    case 'flat':
      return 'same';
    default:
      return 'unknown';
  }
}

/** The tone of the headline figure: a fall is bad, no comparison is a caution, not a pass. */
export function toneOfStatus(status: CockpitStatus): 'good' | 'caution' | 'bad' {
  if (status === 'worse') return 'bad';
  if (status === 'improved' || status === 'flat') return 'good';
  return 'caution';
}

/** The sentence that stands where a change would be, when there is none to show. */
export function noteOfStatus(status: CockpitStatus): string | null {
  switch (status) {
    case 'not_measured':
      return 'Not measured in this window';
    case 'no_baseline':
      return 'No earlier reading to compare with';
    case 'formula_changed':
      return 'Scoring formula changed, so no comparison';
    case 'flat':
      return 'No meaningful change';
    default:
      return null;
  }
}

/** One decimal when there is a fraction, none when there is not: `76`, `76.5`, never `76.0`. */
function plain(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatValue(unit: CockpitMetric['unit'], value: number | null): string {
  if (value === null) return '\u2014';
  return unit === 'percent' ? `${plain(value)}%` : plain(value);
}

/** `+3 pts`, `-4.5 pts`, `+2`: points for a score or a rate, a bare count for a count. */
export function formatDelta(unit: CockpitMetric['unit'], delta: number | null): string | null {
  if (delta === null) return null;
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  const body = plain(Math.abs(delta));
  return unit === 'count' ? `${sign}${body}` : `${sign}${body} pts`;
}

/** What a driver is called on screen. A candidate is said to be one, never the cause. */
export function driverText(driver: CockpitDriver): string {
  return driver.candidate ? `Possibly: ${driver.label}` : driver.label;
}

export function trendOfDelta(delta: number | null): 'up' | 'down' | 'flat' | undefined {
  if (delta === null) return undefined;
  if (delta === 0) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/** The plot, in a 600 x 176 box: bars for what merged, a line for the score beneath them. */
export const PACE_WIDTH = 600;
export const PACE_HEIGHT = 176;
const LEFT = 28;
const RIGHT = 592;
const BARS_TOP = 8;
const BARS_HEIGHT = 64;
const LINE_TOP = 96;
const LINE_HEIGHT = 64;

export interface PaceBar {
  week: string;
  x: number;
  width: number;
  /** The AI-authored part of the bar, drawn from the baseline up. */
  aiY: number;
  aiHeight: number;
  /** The rest of the bar, stacked on the AI part. */
  otherY: number;
  otherHeight: number;
  partial: boolean;
}

export interface PaceGeometry {
  bars: PaceBar[];
  /** Line segments of the score; one per run of weeks graded by the same formula, no gaps. */
  scorePaths: string[];
  scoreDots: Array<{ x: number; y: number; week: string }>;
  /** x positions between two graded weeks whose formula differs: the line is broken there. */
  formulaBreaks: number[];
  maxMerged: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function paceGeometry(pace: readonly CockpitPaceWeek[]): PaceGeometry {
  const step = (RIGHT - LEFT) / Math.max(1, pace.length);
  const barWidth = round2(step * 0.62);
  const maxMerged = Math.max(1, ...pace.map((week) => week.merged));
  const floor = BARS_TOP + BARS_HEIGHT;
  const centre = (index: number) => round2(LEFT + step * index + step / 2);

  const bars: PaceBar[] = pace.map((week, index) => {
    const aiHeight = round2((week.aiAuthored / maxMerged) * BARS_HEIGHT);
    const otherHeight = round2(((week.merged - week.aiAuthored) / maxMerged) * BARS_HEIGHT);
    return {
      week: week.weekStart,
      x: round2(centre(index) - barWidth / 2),
      width: barWidth,
      aiY: round2(floor - aiHeight),
      aiHeight,
      otherY: round2(floor - aiHeight - otherHeight),
      otherHeight,
      partial: week.partial,
    };
  });

  const scorePaths: string[] = [];
  const scoreDots: PaceGeometry['scoreDots'] = [];
  const formulaBreaks: number[] = [];
  let segment: string[] = [];
  let previous: { version: number | null; x: number } | null = null;
  const flush = () => {
    if (segment.length >= 2) scorePaths.push(segment.join(' '));
    segment = [];
  };
  pace.forEach((week, index) => {
    if (week.score === null) {
      // No reading this week: the line stops, rather than leaning across the gap.
      flush();
      return;
    }
    const x = centre(index);
    const y = round2(LINE_TOP + LINE_HEIGHT - (week.score / 100) * LINE_HEIGHT);
    if (previous !== null && previous.version !== week.formulaVersion) {
      // Different formula: the two points are not on one scale, so they are not joined.
      flush();
      formulaBreaks.push(round2((previous.x + x) / 2));
    }
    segment.push(`${segment.length === 0 ? 'M' : 'L'} ${String(x)} ${String(y)}`);
    scoreDots.push({ x, y, week: week.weekStart });
    previous = { version: week.formulaVersion, x };
  });
  flush();

  return { bars, scorePaths, scoreDots, formulaBreaks, maxMerged };
}

export const PACE_LAYOUT = {
  barsTop: BARS_TOP,
  barsHeight: BARS_HEIGHT,
  lineTop: LINE_TOP,
  lineHeight: LINE_HEIGHT,
  left: LEFT,
  right: RIGHT,
} as const;

/** A page one level below a metric: what a QA engineer opens to work on what moved it. */
export interface DeeperLink {
  label: string;
  /** What the page shows, in a sentence, so the link says where it goes. */
  description: string;
  to: string;
}

/**
 * The existing pages that go deeper than a metric, for the project the cockpit shows.
 *
 * These pages are not part of the cockpit. They are what a metric opens into: the gaps behind
 * coverage, the flaky tests and quarantine behind the flaky count, the findings behind a
 * health score. The cockpit says that something moved and the metric page says what moved it;
 * these say what to do about it.
 */
export function deeperLinks(metricId: CockpitMetricId, projectId: string): DeeperLink[] {
  const project = encodeURIComponent(projectId);
  switch (metricId) {
    case 'coverage':
      return [
        {
          label: 'Coverage gaps',
          description: 'The parts of the product no test reaches, worst first.',
          to: `/dashboard/gaps/${project}`,
        },
      ];
    case 'flaky-tests':
      return [
        {
          label: 'Flaky tests',
          description: 'Which tests flip between pass and fail, and how often.',
          to: `/dashboard/flaky/${project}`,
        },
        {
          label: 'Quarantine',
          description: 'The tests set aside, why, and when they come back.',
          to: '/dashboard/quarantine',
        },
      ];
    case 'tests':
      return [
        {
          label: 'Hollow tests',
          description: 'Tests that pass without checking anything.',
          to: `/dashboard/hollow/${project}`,
        },
        {
          label: 'Structure',
          description: 'How the test suite is laid out, and where it is thin.',
          to: `/dashboard/structure/${project}`,
        },
        {
          label: 'Test insights',
          description: 'Failures by cause and the slowest tests.',
          to: '/dashboard/insights',
        },
      ];
    case 'run-pass-rate':
      return [
        {
          label: 'Runs',
          description: 'Every run, newest first.',
          to: '/dashboard/runs',
        },
        {
          label: 'Trends',
          description: 'Pass rate and duration over time.',
          to: '/dashboard/analytics',
        },
      ];
    case 'security':
    case 'code-quality':
    case 'dependencies':
      return [
        {
          label: 'Repository health',
          description: 'The open findings behind the grade, by tool and severity.',
          to: `/dashboard/repo/${project}`,
        },
      ];
  }
}

/** What the cockpit says about one run, for the banner on that run's page. */
export interface ScoreImpact {
  /** The metrics whose drivers name this run. */
  metrics: Array<{ id: CockpitMetricId; label: string; change: number | null; candidate: boolean }>;
  /** Whether the run is named as a driver of the overall score. */
  overall: boolean;
}

/**
 * Which parts of the cockpit name this run. Empty when none does, and then the page shows
 * nothing: a banner on every run would say nothing about any of them.
 */
export function scoreImpactOf(cockpit: Cockpit, runId: string): ScoreImpact {
  const names = (drivers: readonly CockpitDriver[]) =>
    drivers.filter((driver) => driver.kind === 'run' && driver.ref === runId);
  return {
    overall: names(cockpit.overall.drivers).length > 0,
    metrics: cockpit.metrics.flatMap((metric) => {
      const driver = names(metric.drivers)[0];
      return driver === undefined
        ? []
        : [
            {
              id: metric.id,
              label: metric.label,
              change: driver.change,
              candidate: driver.candidate,
            },
          ];
    }),
  };
}

export function hasScoreImpact(impact: ScoreImpact): boolean {
  return impact.overall || impact.metrics.length > 0;
}

/** The commit page for a run's commit, when the project has a GitHub repository. */
export function commitUrl(cockpit: Cockpit, sha: string | null): string | null {
  if (sha === null || cockpit.repository === null) return null;
  return `https://github.com/${cockpit.repository.owner}/${cockpit.repository.repo}/commit/${sha}`;
}

/** The plot of one metric's series, in a 600 x 160 box with room for the axis labels. */
export const SERIES_WIDTH = 600;
export const SERIES_HEIGHT = 160;
const SERIES_PAD_X = 36;
const SERIES_PAD_TOP = 12;
const SERIES_PAD_BOTTOM = 28;

export interface SeriesGeometry {
  /** `null` with fewer than two points: one reading has no line, only a dot. */
  path: string | null;
  dots: Array<{ x: number; y: number; at: string; value: number }>;
  min: number;
  max: number;
  /** Where the baseline sits, when the series reaches back far enough to have one. */
  firstAt: string | null;
  lastAt: string | null;
}

/**
 * Places a series in the box. Time is the order of the readings, not the distance between
 * them: the readings are hourly or per upload, so a gap of a week would otherwise squeeze a
 * busy day into a smudge. The table under the chart carries the dates.
 */
export function seriesGeometry(series: readonly { at: string; value: number }[]): SeriesGeometry {
  const usable = series.filter((point) => Number.isFinite(point.value));
  if (usable.length === 0) {
    return { path: null, dots: [], min: 0, max: 0, firstAt: null, lastAt: null };
  }
  const values = usable.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const innerWidth = SERIES_WIDTH - SERIES_PAD_X * 2;
  const innerHeight = SERIES_HEIGHT - SERIES_PAD_TOP - SERIES_PAD_BOTTOM;
  const step = usable.length === 1 ? 0 : innerWidth / (usable.length - 1);
  const dots = usable.map((point, index) => ({
    // A single reading sits in the middle rather than against the axis.
    x: round2(usable.length === 1 ? SERIES_WIDTH / 2 : SERIES_PAD_X + step * index),
    y: round2(SERIES_PAD_TOP + innerHeight - ((point.value - min) / span) * innerHeight),
    at: point.at,
    value: point.value,
  }));
  return {
    path:
      dots.length < 2
        ? null
        : dots
            .map((dot, index) => `${index === 0 ? 'M' : 'L'} ${String(dot.x)} ${String(dot.y)}`)
            .join(' '),
    dots,
    min,
    max,
    firstAt: usable[0]?.at ?? null,
    lastAt: usable.at(-1)?.at ?? null,
  };
}

export const SERIES_LAYOUT = {
  padX: SERIES_PAD_X,
  padTop: SERIES_PAD_TOP,
  padBottom: SERIES_PAD_BOTTOM,
} as const;

/**
 * Where a run driver opens inside this product, or `null` for a driver that is not a run.
 * The query says the person came from the cockpit and for which window, so the run's page can
 * ask the same cockpit and show what it said about the run; without it the page asks nothing.
 */
export function runDriverHref(driver: CockpitDriver, window: CockpitWindow): string | null {
  if (driver.kind !== 'run' || driver.ref === null) return null;
  return `${runDetailPath(driver.ref)}?from=cockpit&window=${window}`;
}
