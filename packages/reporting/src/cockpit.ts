import type {
  Cockpit,
  CockpitDriver,
  CockpitFormulaBreak,
  CockpitMetric,
  CockpitMetricId,
  CockpitOverall,
  CockpitPaceWeek,
  CockpitSeriesPoint,
  CockpitStatus,
  CockpitWindow,
} from '@lupin/shared-contracts';
import { riskSignals, type CockpitRiskPullRequest } from './cockpit-risk.js';

/**
 * The cockpit: whether the product is better or worse than it was, and why.
 *
 * Pure. It is handed stored readings and returns one payload; it holds no clock, no database
 * and no network. Three rules shape every line of it:
 *
 * 1. **A change needs two readings.** With nothing in the window the answer is `not_measured`;
 *    with nothing before it, `no_baseline`. Neither ever becomes a delta of 0, because "nothing
 *    changed" and "nothing was measured" are different statements about a product.
 * 2. **Two formulas are never compared.** A health reading carries the version of the formula
 *    that graded it. Readings of different versions, or of the unversioned version 0, are
 *    `formula_changed`: the difference would be the formula's, not the product's.
 * 3. **A cause is named only when it is known.** A step in the score is tied to the commit the
 *    report that caused it carried. With no commit it is `unknown`. The hourly scan metrics
 *    carry no commit at all, so the runs that happened while they moved are offered as
 *    candidates and none is called the cause. Nothing is matched by time alone.
 *
 * The readings are history, never an input to a decision: the live grade, the gate and the
 * readiness verdict are computed elsewhere, from live data.
 */

const DAY_MS = 86_400_000;
/** A baseline older than this (or than the window, if longer) is stale and not used. */
const MIN_LOOKBACK_MS = 7 * DAY_MS;
/** A change smaller than this is `flat`. */
const FLAT_BELOW = 0.5;
/** A step smaller than this is rounding, not a step. */
const MIN_STEP = 0.05;
/** A pass rate over fewer finished runs than this is noise, not a measurement. */
const MIN_FINISHED_RUNS = 3;
const MAX_SERIES = 30;
const MAX_DRIVERS = 3;
const MAX_LABEL = 120;
const WEEK_MS = 7 * DAY_MS;
const PACE_WEEKS = 12;

export type CockpitLetter = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
export type CockpitDimension = 'security' | 'tests' | 'code-quality' | 'dependencies';

/** One `health_snapshots` row of the branch being shown. */
export interface CockpitHealthPoint {
  at: Date;
  score: number | null;
  letter: CockpitLetter | null;
  /** `GRADE_FORMULA_VERSION` when graded; 0 is "before versions existed". */
  formulaVersion: number;
  /** The commit of the report that caused the snapshot; null when none did. */
  commitSha: string | null;
  dimensions: Partial<Record<CockpitDimension, number | null>>;
}

/** One `scan_snapshots` row: hourly, with no branch and no commit. */
export interface CockpitScanPoint {
  at: Date;
  coverage: number | null;
  flakyTests: number;
}

export interface CockpitRun {
  id: string;
  startedAt: Date;
  commitSha: string | null;
  status: 'running' | 'passed' | 'failed' | 'interrupted';
  prNumber: number | null;
}

export interface CockpitPullRequest {
  number: number;
  title: string;
  mergedAt: Date | null;
  mergeCommitSha: string | null;
  headSha: string | null;
}

/** A change that landed on the shown branch: a merged pull request, for the pace series. */
export interface CockpitChange {
  mergedAt: Date | null;
  additions: number;
  deletions: number;
  attribution: 'agent-authored' | 'ai-assisted' | 'human' | 'unknown';
}

export interface CockpitDeployment {
  createdAt: Date;
  environment: string;
  status: 'success' | 'failure';
}

export interface CockpitInputs {
  project: { id: string; name: string };
  branch: string;
  now: Date;
  window: CockpitWindow;
  health: readonly CockpitHealthPoint[];
  scans: readonly CockpitScanPoint[];
  runs: readonly CockpitRun[];
  pullRequests: readonly CockpitPullRequest[];
  /** Pull requests merged into the shown branch, for the pace series; any age, the series keeps twelve weeks. */
  changes: readonly CockpitChange[];
  /** Pull requests the risk block reads: open ones and recent merges, see `riskSignals`. */
  riskPullRequests: readonly CockpitRiskPullRequest[];
  deployments: readonly CockpitDeployment[];
  productionEnvironments: readonly string[];
  /** The project's GitHub repository, when it has one; commit and pull request links need it. */
  repository: { owner: string; repo: string } | null;
}

interface Reading {
  at: Date;
  value: number;
  formulaVersion: number;
  commitSha: string | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const byTime = (left: { at: Date }, right: { at: Date }): number =>
  left.at.getTime() - right.at.getTime();

interface MetricSpec {
  id: CockpitMetricId;
  label: string;
  unit: CockpitMetric['unit'];
  higherIsBetter: boolean;
  /** What it means when the value went up, and when it went down. */
  phrase: { up: string; down: string };
}

const SPECS: Readonly<Record<CockpitMetricId, MetricSpec>> = {
  security: {
    id: 'security',
    label: 'Security',
    unit: 'score',
    higherIsBetter: true,
    phrase: { up: 'a higher security score', down: 'a lower security score' },
  },
  tests: {
    id: 'tests',
    label: 'Tests',
    unit: 'score',
    higherIsBetter: true,
    phrase: { up: 'a higher tests score', down: 'a lower tests score' },
  },
  'code-quality': {
    id: 'code-quality',
    label: 'Code quality',
    unit: 'score',
    higherIsBetter: true,
    phrase: { up: 'better code quality', down: 'worse code quality' },
  },
  dependencies: {
    id: 'dependencies',
    label: 'Dependencies',
    unit: 'score',
    higherIsBetter: true,
    phrase: { up: 'healthier dependencies', down: 'less healthy dependencies' },
  },
  coverage: {
    id: 'coverage',
    label: 'Coverage',
    unit: 'percent',
    higherIsBetter: true,
    phrase: { up: 'higher coverage', down: 'lower coverage' },
  },
  'flaky-tests': {
    id: 'flaky-tests',
    label: 'Flaky tests',
    unit: 'count',
    higherIsBetter: false,
    phrase: { up: 'more flaky tests', down: 'fewer flaky tests' },
  },
  'run-pass-rate': {
    id: 'run-pass-rate',
    label: 'Run pass rate',
    unit: 'percent',
    higherIsBetter: true,
    phrase: { up: 'a higher run pass rate', down: 'a lower run pass rate' },
  },
};

const ORDER: readonly CockpitMetricId[] = [
  'security',
  'tests',
  'code-quality',
  'dependencies',
  'coverage',
  'flaky-tests',
  'run-pass-rate',
];

interface Comparison {
  value: number | null;
  baseline: number | null;
  delta: number | null;
  status: CockpitStatus;
  /** The two readings compared, when there are two. */
  current: Reading | null;
  base: Reading | null;
}

interface Period {
  /** The compared period starts here. `null`: `release` was asked and nothing has shipped. */
  start: Date | null;
  now: Date;
  lookbackMs: number;
}

function statusOf(delta: number, higherIsBetter: boolean): CockpitStatus {
  if (Math.abs(delta) < FLAT_BELOW) return 'flat';
  return delta > 0 === higherIsBetter ? 'improved' : 'worse';
}

/**
 * The latest reading inside the period against the latest reading before it.
 *
 * `versioned` readings (the health grade) are compared only when both were graded by the same
 * formula and that formula is a real version; the raw measures (coverage, flaky tests) carry
 * no formula and are compared as they are.
 */
function compare(
  readings: readonly Reading[],
  period: Period,
  higherIsBetter: boolean,
  versioned: boolean,
): Comparison {
  const upToNow = readings.filter((reading) => reading.at.getTime() <= period.now.getTime());
  const inPeriod = upToNow.filter(
    (reading) => period.start === null || reading.at.getTime() > period.start.getTime(),
  );
  const current = inPeriod.at(-1) ?? null;
  if (current === null) {
    return {
      value: null,
      baseline: null,
      delta: null,
      status: 'not_measured',
      current: null,
      base: null,
    };
  }
  const value = round1(current.value);
  const base =
    period.start === null
      ? null
      : (upToNow
          .filter(
            (reading) =>
              reading.at.getTime() <= (period.start as Date).getTime() &&
              reading.at.getTime() >= (period.start as Date).getTime() - period.lookbackMs,
          )
          .at(-1) ?? null);
  if (base === null) {
    return { value, baseline: null, delta: null, status: 'no_baseline', current, base: null };
  }
  const baseline = round1(base.value);
  if (
    versioned &&
    (current.formulaVersion === 0 || current.formulaVersion !== base.formulaVersion)
  ) {
    return { value, baseline, delta: null, status: 'formula_changed', current, base };
  }
  const delta = round1(current.value - base.value);
  return { value, baseline, delta, status: statusOf(delta, higherIsBetter), current, base };
}

interface Step {
  from: Reading;
  to: Reading;
  change: number;
}

/** Consecutive readings in the period, within one formula, that moved by more than rounding. */
function stepsOf(readings: readonly Reading[], period: Period, versioned: boolean): Step[] {
  if (period.start === null) return [];
  const start = period.start.getTime();
  const earliest = start - period.lookbackMs;
  const window = readings.filter(
    (reading) => reading.at.getTime() >= earliest && reading.at.getTime() <= period.now.getTime(),
  );
  const steps: Step[] = [];
  for (let index = 1; index < window.length; index += 1) {
    const from = window[index - 1] as Reading;
    const to = window[index] as Reading;
    if (to.at.getTime() <= start) continue;
    if (versioned && (from.formulaVersion !== to.formulaVersion || to.formulaVersion === 0)) {
      continue;
    }
    const change = round1(to.value - from.value);
    if (Math.abs(change) < MIN_STEP) continue;
    steps.push({ from, to, change });
  }
  // Largest first. `sort` is stable, so equal steps stay oldest first.
  return steps.sort((left, right) => Math.abs(right.change) - Math.abs(left.change));
}

const truncate = (text: string): string =>
  text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL - 1)}…`;

class Links {
  constructor(private readonly repository: CockpitInputs['repository']) {}

  commit(sha: string): string | null {
    return this.repository === null
      ? null
      : `https://github.com/${this.repository.owner}/${this.repository.repo}/commit/${sha}`;
  }

  pullRequest(number: number): string | null {
    return this.repository === null
      ? null
      : `https://github.com/${this.repository.owner}/${this.repository.repo}/pull/${String(number)}`;
  }
}

/** The pull request, run or commit a health step is tied to; `unknown` without a commit. */
function healthDriver(step: Step, inputs: CockpitInputs, links: Links): CockpitDriver {
  const at = step.to.at.toISOString();
  const sha = step.to.commitSha;
  if (sha === null) {
    return {
      kind: 'unknown',
      ref: null,
      label: 'No commit was recorded for this change',
      url: null,
      candidate: false,
      change: step.change,
      at,
    };
  }
  // More than one pull request or run can carry a commit. Pick by a rule that does not depend
  // on the order the rows arrived in: the lowest pull request number, the most recent run.
  const pullRequest = inputs.pullRequests
    .filter((candidate) => candidate.mergeCommitSha === sha || candidate.headSha === sha)
    .sort((left, right) => left.number - right.number)[0];
  if (pullRequest !== undefined) {
    return {
      kind: 'pull_request',
      ref: String(pullRequest.number),
      label: truncate(`PR #${String(pullRequest.number)}: ${pullRequest.title}`),
      url: links.pullRequest(pullRequest.number),
      candidate: false,
      change: step.change,
      at,
    };
  }
  const run = inputs.runs
    .filter((candidate) => candidate.commitSha === sha)
    .sort(
      (left, right) =>
        right.startedAt.getTime() - left.startedAt.getTime() || left.id.localeCompare(right.id),
    )[0];
  if (run !== undefined) {
    return {
      kind: 'run',
      ref: run.id,
      label: `Run on ${sha.slice(0, 7)}`,
      url: null,
      candidate: false,
      change: step.change,
      at,
    };
  }
  return {
    kind: 'commit',
    ref: sha,
    label: `Commit ${sha.slice(0, 7)}`,
    url: links.commit(sha),
    candidate: false,
    change: step.change,
    at,
  };
}

/** The runs that happened while a scan metric moved: candidates, never "the cause". */
function runDriver(run: CockpitInputs['runs'][number], change: number | null): CockpitDriver {
  return {
    kind: 'run',
    ref: run.id,
    label:
      run.commitSha === null ? `Run ${run.id.slice(0, 8)}` : `Run on ${run.commitSha.slice(0, 7)}`,
    url: null,
    candidate: true,
    change,
    at: run.startedAt.toISOString(),
  };
}

function scanDrivers(steps: readonly Step[], inputs: CockpitInputs): CockpitDriver[] {
  const drivers: CockpitDriver[] = [];
  for (const step of steps) {
    if (drivers.length >= MAX_DRIVERS) break;
    const between = inputs.runs
      .filter(
        (run) =>
          run.startedAt.getTime() > step.from.at.getTime() &&
          run.startedAt.getTime() <= step.to.at.getTime(),
      )
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
    if (between.length === 0) {
      drivers.push({
        kind: 'unknown',
        ref: null,
        label: 'No run was recorded while this changed',
        url: null,
        candidate: false,
        change: step.change,
        at: step.to.at.toISOString(),
      });
      continue;
    }
    const room = MAX_DRIVERS - drivers.length;
    drivers.push(...between.slice(0, room).map((run) => runDriver(run, step.change)));
  }
  return drivers;
}

const seriesOf = (readings: readonly Reading[], now: Date): CockpitSeriesPoint[] =>
  readings
    .filter((reading) => reading.at.getTime() <= now.getTime())
    .slice(-MAX_SERIES)
    .map((reading) => ({ at: reading.at.toISOString(), value: round1(reading.value) }));

function healthReadings(
  points: readonly CockpitHealthPoint[],
  pick: (point: CockpitHealthPoint) => number | null | undefined,
): Reading[] {
  return points
    .flatMap((point) => {
      const value = pick(point);
      return value === null || value === undefined
        ? []
        : [
            {
              at: point.at,
              value,
              formulaVersion: point.formulaVersion,
              commitSha: point.commitSha,
            },
          ];
    })
    .sort(byTime);
}

function scanReadings(
  points: readonly CockpitScanPoint[],
  pick: (point: CockpitScanPoint) => number | null,
): Reading[] {
  return points
    .flatMap((point) => {
      const value = pick(point);
      return value === null
        ? []
        : [{ at: point.at, value, formulaVersion: 0, commitSha: null as string | null }];
    })
    .sort(byTime);
}

function metricFrom(
  spec: MetricSpec,
  comparison: Comparison,
  readings: readonly Reading[],
  drivers: readonly CockpitDriver[],
  now: Date,
): CockpitMetric {
  const moved = comparison.status === 'improved' || comparison.status === 'worse';
  return {
    id: spec.id,
    label: spec.label,
    unit: spec.unit,
    higherIsBetter: spec.higherIsBetter,
    value: comparison.value,
    baseline: comparison.baseline,
    delta: comparison.delta,
    status: comparison.status,
    series: seriesOf(readings, now),
    drivers: moved ? drivers.slice(0, MAX_DRIVERS) : [],
  };
}

const utcDay = (date: Date): number => Math.floor(date.getTime() / DAY_MS) * DAY_MS;

/** The pass rate of finished runs, or `null` below the sample that makes it a measurement. */
function rateOf(runs: readonly CockpitRun[]): number | null {
  return runs.length < MIN_FINISHED_RUNS
    ? null
    : (runs.filter((run) => run.status === 'passed').length / runs.length) * 100;
}

/** Pass rate per day over finished runs: the series behind the card. */
function dailyPassRates(finished: readonly CockpitRun[]): CockpitSeriesPoint[] {
  const buckets = new Map<number, CockpitRun[]>();
  for (const run of finished) {
    const day = utcDay(run.startedAt);
    buckets.set(day, [...(buckets.get(day) ?? []), run]);
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .slice(-MAX_SERIES)
    .map(([day, runs]) => ({
      at: new Date(day).toISOString(),
      value: round1((runs.filter((run) => run.status === 'passed').length / runs.length) * 100),
    }));
}

/** The failed runs of the period, newest first: what a fall in the pass rate is made of. */
function failedRunDrivers(runs: readonly CockpitRun[]): CockpitDriver[] {
  return runs
    .filter((run) => run.status === 'failed')
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
    .slice(0, MAX_DRIVERS)
    .map((run) => ({
      kind: 'run' as const,
      ref: run.id,
      label:
        run.commitSha === null
          ? `Failed run ${run.id.slice(0, 8)}`
          : `Failed run on ${run.commitSha.slice(0, 7)}`,
      url: null,
      candidate: false,
      change: null,
      at: run.startedAt.toISOString(),
    }));
}

type RateParts = Pick<CockpitMetric, 'value' | 'baseline' | 'delta' | 'status' | 'drivers'>;

function passRateMetric(series: CockpitSeriesPoint[], parts: RateParts): CockpitMetric {
  const spec = SPECS['run-pass-rate'];
  return {
    id: spec.id,
    label: spec.label,
    unit: spec.unit,
    higherIsBetter: true,
    series,
    ...parts,
  };
}

/** The pass rate of finished runs, this period against the one before it. */
function runPassRate(inputs: CockpitInputs, period: Period): CockpitMetric {
  const now = inputs.now.getTime();
  const finished = inputs.runs.filter(
    (run) => (run.status === 'passed' || run.status === 'failed') && run.startedAt.getTime() <= now,
  );
  const start = period.start ?? new Date(now - MIN_LOOKBACK_MS);
  const length = Math.max(now - start.getTime(), MIN_LOOKBACK_MS);
  const currentRuns = finished.filter((run) => run.startedAt.getTime() > start.getTime());
  const previousRuns =
    period.start === null
      ? []
      : finished.filter(
          (run) =>
            run.startedAt.getTime() > start.getTime() - length &&
            run.startedAt.getTime() <= start.getTime(),
        );
  const currentRate = rateOf(currentRuns);
  const previousRate = rateOf(previousRuns);
  const series = dailyPassRates(finished);

  if (currentRate === null) {
    return passRateMetric(series, {
      value: null,
      baseline: null,
      delta: null,
      status: 'not_measured',
      drivers: [],
    });
  }
  const value = round1(currentRate);
  if (previousRate === null) {
    return passRateMetric(series, {
      value,
      baseline: null,
      delta: null,
      status: 'no_baseline',
      drivers: [],
    });
  }
  const delta = round1(currentRate - previousRate);
  const status = statusOf(delta, true);
  return passRateMetric(series, {
    value,
    baseline: round1(previousRate),
    delta,
    status,
    drivers: status === 'worse' ? failedRunDrivers(currentRuns) : [],
  });
}
/** Monday 00:00 UTC of the week `at` falls in. The same week the AI-code share is bucketed into. */
function weekStartOf(at: number): number {
  const day = new Date(at);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return midnight - ((day.getUTCDay() + 6) % 7) * DAY_MS;
}

/**
 * The last twelve weeks of pace beside the score: what merged, how many lines it changed, how
 * much of it was written by an agent, and the last score recorded that week.
 *
 * Every week is present. A week with nothing merged has no share (`null`, not 0%) and a week
 * with no reading has no score, so a chart cannot draw a gap as a trend. The AI share is by
 * count of merged changes, and a change whose authorship is unknown is counted as unattributed,
 * which is neither AI nor human: saying it was human would be a claim nothing supports.
 */
function emptyWeeks(first: number): CockpitPaceWeek[] {
  return Array.from({ length: PACE_WEEKS }, (_, index) => ({
    weekStart: new Date(first + index * WEEK_MS).toISOString().slice(0, 10),
    partial: index === PACE_WEEKS - 1,
    merged: 0,
    linesChanged: 0,
    aiAuthored: 0,
    unattributed: 0,
    aiShare: null,
    score: null,
    formulaVersion: null,
  }));
}

/** The week `at` falls in, or `undefined` when it is before the twelve weeks or after `now`. */
function weekOfTime(
  weeks: readonly CockpitPaceWeek[],
  at: number,
  first: number,
  now: number,
): CockpitPaceWeek | undefined {
  if (!Number.isFinite(at) || at < first || at > now) return undefined;
  return weeks[Math.floor((at - first) / WEEK_MS)];
}

function countChange(week: CockpitPaceWeek, change: CockpitChange): void {
  week.merged += 1;
  week.linesChanged += Math.max(0, change.additions) + Math.max(0, change.deletions);
  if (change.attribution === 'agent-authored' || change.attribution === 'ai-assisted') {
    week.aiAuthored += 1;
  } else if (change.attribution === 'unknown') {
    week.unattributed += 1;
  }
}

function paceOf(inputs: CockpitInputs, scored: readonly Reading[]): CockpitPaceWeek[] {
  const now = inputs.now.getTime();
  const first = weekStartOf(now) - (PACE_WEEKS - 1) * WEEK_MS;
  const weeks = emptyWeeks(first);

  for (const change of inputs.changes) {
    if (change.mergedAt === null) continue;
    const week = weekOfTime(weeks, change.mergedAt.getTime(), first, now);
    if (week !== undefined) countChange(week, change);
  }
  for (const week of weeks) {
    if (week.merged > 0) week.aiShare = round1((week.aiAuthored / week.merged) * 100);
  }
  // Readings are sorted oldest first, so the last one that falls in a week is the week's.
  for (const reading of scored) {
    const week = weekOfTime(weeks, reading.at.getTime(), first, now);
    if (week === undefined) continue;
    week.score = round1(reading.value);
    week.formulaVersion = reading.formulaVersion;
  }
  return weeks;
}
/** The last successful production deployment at or before `now`, or null. */
function lastRelease(inputs: CockpitInputs): Date | null {
  const production = new Set(inputs.productionEnvironments.map((name) => name.toLowerCase()));
  let latest: Date | null = null;
  for (const deployment of inputs.deployments) {
    if (deployment.status !== 'success') continue;
    if (!production.has(deployment.environment.toLowerCase())) continue;
    if (deployment.createdAt.getTime() > inputs.now.getTime()) continue;
    if (latest === null || deployment.createdAt.getTime() > latest.getTime()) {
      latest = deployment.createdAt;
    }
  }
  return latest;
}

/** The most recent place two neighbouring readings were graded by different formulas. */
function formulaBreakOf(readings: readonly Reading[], period: Period): CockpitFormulaBreak | null {
  const earliest =
    period.start === null ? Number.NEGATIVE_INFINITY : period.start.getTime() - period.lookbackMs;
  const window = readings.filter(
    (reading) => reading.at.getTime() >= earliest && reading.at.getTime() <= period.now.getTime(),
  );
  for (let index = window.length - 1; index >= 1; index -= 1) {
    const from = window[index - 1] as Reading;
    const to = window[index] as Reading;
    if (from.formulaVersion !== to.formulaVersion && to.formulaVersion >= 1) {
      return { at: to.at.toISOString(), from: from.formulaVersion, to: to.formulaVersion };
    }
  }
  return null;
}

const joinPhrases = (phrases: readonly string[]): string => phrases.join(' and ');

/** Only what moved the same way as the score can be said to explain it. */
function movedHeadline(
  overall: Comparison,
  sinceWords: string,
  metrics: readonly CockpitMetric[],
): string {
  const delta = overall.delta as number;
  const points = Math.round(Math.abs(delta));
  const lead = `${delta > 0 ? 'Up' : 'Down'} ${String(points)} point${points === 1 ? '' : 's'} ${sinceWords}`;
  const movers = metrics
    .filter((metric) => metric.status === overall.status && metric.delta !== null)
    .sort((left, right) => Math.abs(right.delta as number) - Math.abs(left.delta as number))
    .slice(0, 2)
    .map((metric) =>
      (metric.delta as number) > 0 ? SPECS[metric.id].phrase.up : SPECS[metric.id].phrase.down,
    );
  return movers.length === 0 ? `${lead}.` : `${lead}, mostly ${joinPhrases(movers)}.`;
}
function headlineOf(
  window: CockpitWindow,
  since: Date | null,
  overall: Comparison,
  formulaBreak: CockpitFormulaBreak | null,
  metrics: readonly CockpitMetric[],
): string {
  const sinceWords = window === 'release' ? 'since the last release' : 'since last week';
  if (window === 'release' && since === null) {
    return 'Nothing has shipped to production yet, so there is no release to compare with.';
  }
  switch (overall.status) {
    case 'not_measured':
      return window === 'release'
        ? 'Nothing was measured since the last release.'
        : 'Nothing was measured in the last 7 days.';
    case 'no_baseline':
      return `The score is ${String(overall.value)}. There is no earlier reading to compare with.`;
    case 'formula_changed':
      return formulaBreak === null
        ? 'The score cannot be compared with earlier readings, because they were graded before scoring formulas were versioned.'
        : `The scoring formula changed on ${formulaBreak.at.slice(0, 10)}, so the score cannot be compared with earlier readings.`;
    case 'flat':
      return `No meaningful change ${sinceWords}: the score is ${String(overall.value)}.`;
    default:
      return movedHeadline(overall, sinceWords, metrics);
  }
}

/** The headline figure: the overall score, its change, and the steps that moved it. */
function overallOf(
  inputs: CockpitInputs,
  comparison: Comparison,
  readings: readonly Reading[],
  period: Period,
  links: Links,
): CockpitOverall {
  const moved = comparison.status === 'improved' || comparison.status === 'worse';
  const latestHealth = inputs.health
    .filter((point) => point.score !== null && point.at.getTime() <= inputs.now.getTime())
    .sort(byTime)
    .at(-1);
  return {
    score: comparison.value,
    // The letter belongs to the reading the score is, and is not shown when nothing is measured.
    letter: comparison.value === null ? null : (latestHealth?.letter ?? null),
    baseline: comparison.baseline,
    delta: comparison.delta,
    status: comparison.status,
    drivers: moved
      ? stepsOf(readings, period, true)
          .slice(0, MAX_DRIVERS)
          .map((step) => healthDriver(step, inputs, links))
      : [],
  };
}

/** One metric of the seven, from the readings that feed it. */
function metricOf(
  id: CockpitMetricId,
  inputs: CockpitInputs,
  period: Period,
  links: Links,
): CockpitMetric {
  const spec = SPECS[id];
  if (id === 'run-pass-rate') return runPassRate(inputs, period);
  if (id === 'coverage' || id === 'flaky-tests') {
    const readings = scanReadings(inputs.scans, (point) =>
      id === 'coverage' ? point.coverage : point.flakyTests,
    );
    const comparison = compare(readings, period, spec.higherIsBetter, false);
    const drivers = scanDrivers(stepsOf(readings, period, false), inputs);
    return metricFrom(spec, comparison, readings, drivers, inputs.now);
  }
  const dimension = id as CockpitDimension;
  const readings = healthReadings(inputs.health, (point) => point.dimensions[dimension]);
  const comparison = compare(readings, period, spec.higherIsBetter, true);
  const drivers = stepsOf(readings, period, true)
    .slice(0, MAX_DRIVERS)
    .map((step) => healthDriver(step, inputs, links));
  return metricFrom(spec, comparison, readings, drivers, inputs.now);
}

export function buildCockpit(inputs: CockpitInputs): Cockpit {
  const links = new Links(inputs.repository);
  const since =
    inputs.window === '7d' ? new Date(inputs.now.getTime() - 7 * DAY_MS) : lastRelease(inputs);
  const lookbackMs = Math.max(
    since === null ? MIN_LOOKBACK_MS : inputs.now.getTime() - since.getTime(),
    MIN_LOOKBACK_MS,
  );
  const period: Period = { start: since, now: inputs.now, lookbackMs };

  const overallReadings = healthReadings(inputs.health, (point) => point.score);
  const overall = compare(overallReadings, period, true, true);
  const metrics = ORDER.map((id) => metricOf(id, inputs, period, links));
  const formulaBreak = formulaBreakOf(overallReadings, period);
  return {
    projectId: inputs.project.id,
    projectName: inputs.project.name,
    branch: inputs.branch,
    window: inputs.window,
    generatedAt: inputs.now.toISOString(),
    since: since === null ? null : since.toISOString(),
    headline: headlineOf(inputs.window, since, overall, formulaBreak, metrics),
    overall: overallOf(inputs, overall, overallReadings, period, links),
    formulaBreak,
    metrics,
    pace: paceOf(inputs, overallReadings),
    risks: riskSignals({
      pullRequests: inputs.riskPullRequests,
      branch: inputs.branch,
      now: inputs.now,
      repository: inputs.repository,
    }),
    repository: inputs.repository,
  };
}
