import { reportCockpitOf, type ReportCockpit } from '@lupin/reporting';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { cockpit, type CockpitOptions } from './cockpit-service.js';
import { hasChartData, renderPaceChart, type TrendChart } from './trend-chart.js';

/**
 * What the cockpit adds to a scheduled report: its headline and what moved, and the chart.
 *
 * The workspace's report names no project, so this reads the cockpit's own default: the
 * project with the most recent health reading. A workspace with several projects gets the
 * one that last reported, and the report's other lines still cover all of them.
 *
 * The cockpit is an addition to a report and never a condition of one. A workspace with no
 * project, or a cockpit that cannot be read, returns `null` and the report goes out as it
 * always did; a read that failed for any reason other than "no project" is passed to `onError`
 * so it is not silent.
 */
export interface CockpitDigest {
  cockpit: ReportCockpit;
  /** `null` when there is nothing to draw: no week merged anything and none was scored. */
  image: TrendChart | null;
}

export async function loadCockpitDigest(
  options: CockpitOptions,
  onError?: (error: unknown) => void,
): Promise<CockpitDigest | null> {
  try {
    const reading = await cockpit(options, { window: '7d' });
    return {
      cockpit: reportCockpitOf(reading),
      image: hasChartData(reading.pace) ? renderPaceChart(reading.pace) : null,
    };
  } catch (error) {
    if (!(error instanceof DomainError && error.code === ErrorCode.NOT_FOUND)) onError?.(error);
    return null;
  }
}
