/**
 * The operator's signals (plan 1795712849115 task 8): is a runner alive, are connectors
 * failing, and are results still arriving.
 *
 * The same rules as `metrics.ts`, which `ops.metrics-endpoint` states: no run, test or tenant
 * data, no per-URL label, and no database query, so a scrape stays a memory read. Each
 * value is recorded where the event happens and read here:
 *
 *  - the last runner heartbeat, so `lupin_runner_heartbeat_age_seconds` says how long the
 *    runners have been silent (absent until the first heartbeat, because "never" is not 0);
 *  - connector calls that failed, by connector. The label is the adapter's manifest name, and
 *    adapters are composed in code, so the label set is fixed and no request can grow it;
 *  - reporter events accepted, and the time of the last one, so a pipeline that stopped
 *    sending is visible as an age that grows.
 */
import type { ConnectorAdapter } from '@lupin/connectors-sdk';
import type { Series } from './metrics.js';

let lastHeartbeatAt: number | undefined;
let lastReporterEventAt: number | undefined;
let reporterEvents = 0;
const connectorCalls = new Map<string, { calls: number; failures: number }>();

/** A runner reported in. */
export function recordRunnerHeartbeat(at: number = Date.now()): void {
  lastHeartbeatAt = at;
}

/** The reporter accepted `count` events. */
export function recordReporterEvents(count: number, at: number = Date.now()): void {
  if (!Number.isInteger(count) || count <= 0) return;
  reporterEvents += count;
  lastReporterEventAt = at;
}

/**
 * The same adapter, counting its calls and its failures.
 *
 * A failure is a result whose status is `error`, or a throw. The result and the throw pass
 * through unchanged: this only observes.
 */
export function metered<A extends ConnectorAdapter>(adapter: A): A {
  const name = adapter.manifest.name;
  const count = (failed: boolean): void => {
    const current = connectorCalls.get(name) ?? { calls: 0, failures: 0 };
    connectorCalls.set(name, {
      calls: current.calls + 1,
      failures: current.failures + (failed ? 1 : 0),
    });
  };
  const wrapped: ConnectorAdapter = {
    manifest: adapter.manifest,
    execute: async (request, secret) => {
      try {
        const result = await adapter.execute(request, secret);
        count(result.status === 'error');
        return result;
      } catch (error) {
        count(true);
        throw error;
      }
    },
  };
  // The adapter's own fields first, so anything beyond the port survives the wrapping.
  return Object.assign(Object.create(adapter) as A, wrapped);
}

/** For tests: forget everything recorded. */
export function resetOperatorMetrics(): void {
  lastHeartbeatAt = undefined;
  lastReporterEventAt = undefined;
  reporterEvents = 0;
  connectorCalls.clear();
}

/** The operator series, at `now`. */
export function operatorSeries(now: number = Date.now()): Series[] {
  const age = (at: number | undefined): number | undefined =>
    at === undefined ? undefined : Math.max(0, Math.round((now - at) / 1000));
  const series: Series[] = [];
  const heartbeat = age(lastHeartbeatAt);
  if (heartbeat !== undefined) {
    series.push({
      name: 'lupin_runner_heartbeat_age_seconds',
      type: 'gauge',
      help: 'Seconds since any runner last sent a heartbeat to this process.',
      labels: {},
      value: heartbeat,
    });
  }
  series.push({
    name: 'lupin_reporter_events_total',
    type: 'counter',
    help: 'Reporter events this process accepted.',
    labels: {},
    value: reporterEvents,
  });
  const lastEvent = age(lastReporterEventAt);
  if (lastEvent !== undefined) {
    series.push({
      name: 'lupin_reporter_last_event_age_seconds',
      type: 'gauge',
      help: 'Seconds since this process last accepted a reporter event.',
      labels: {},
      value: lastEvent,
    });
  }
  for (const [connector, { calls, failures }] of [...connectorCalls].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    series.push(
      {
        name: 'lupin_connector_calls_total',
        type: 'counter',
        help: 'Connector calls made by this process, by connector.',
        labels: { connector },
        value: calls,
      },
      {
        name: 'lupin_connector_failures_total',
        type: 'counter',
        help: 'Connector calls that failed, by connector.',
        labels: { connector },
        value: failures,
      },
    );
  }
  return series;
}
