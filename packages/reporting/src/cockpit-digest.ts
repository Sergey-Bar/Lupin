import type { Cockpit, CockpitMetric } from '@lupin/shared-contracts';
import { MAX_CHANGES, type ReportCockpit, type ReportLine } from './report.js';

/**
 * The cockpit, as the head of a digest: its own sentence, and the metrics that moved most.
 *
 * The sentence is the cockpit's and is not reworded here, so a channel message and the screen
 * cannot disagree about whether the week was good. Only a metric the cockpit says improved or
 * worsened is listed, with both of its readings: a metric that held, was not measured, had no
 * baseline or crossed a formula change is not news, and saying it moved would be a claim the
 * cockpit did not make.
 */
export function reportCockpitOf(cockpit: Cockpit): ReportCockpit {
  const tone: ReportCockpit['tone'] =
    cockpit.overall.status === 'worse'
      ? 'bad'
      : cockpit.overall.status === 'improved' || cockpit.overall.status === 'flat'
        ? 'good'
        : 'caution';
  return { headline: cockpit.headline, tone, changes: changesOf(cockpit).slice(0, MAX_CHANGES) };
}

interface Moved {
  metric: CockpitMetric;
  value: number;
  baseline: number;
  delta: number;
}

function changesOf(cockpit: Cockpit): ReportLine[] {
  const moved: Moved[] = cockpit.metrics.flatMap((metric) =>
    (metric.status === 'improved' || metric.status === 'worse') &&
    metric.value !== null &&
    metric.baseline !== null &&
    metric.delta !== null
      ? [{ metric, value: metric.value, baseline: metric.baseline, delta: metric.delta }]
      : [],
  );
  // Largest move first; `sort` is stable, so a tie keeps the order the cockpit lists them in.
  return moved
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .map((entry) => ({
      tone: entry.metric.status === 'improved' ? ('good' as const) : ('bad' as const),
      text: describe(entry),
    }));
}

/** One decimal when there is a fraction, none when there is not. */
const plain = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

function describe({ metric, value, baseline, delta }: Moved): string {
  const verb = delta > 0 ? 'rose' : 'fell';
  const size = plain(Math.abs(delta));
  const suffix = metric.unit === 'percent' ? '%' : '';
  const range = `${plain(baseline)}${suffix} → ${plain(value)}${suffix}`;
  return metric.unit === 'count'
    ? `${metric.label} ${verb} by ${size} (${range})`
    : `${metric.label} ${verb} ${size} pts (${range})`;
}
