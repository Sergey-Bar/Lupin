import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectorAdapter, ConnectorResult } from '@lupin/connectors-sdk';
import { collect, renderExposition } from './metrics.js';
import {
  metered,
  operatorSeries,
  recordReporterEvents,
  recordRunnerHeartbeat,
  resetOperatorMetrics,
} from './operator-metrics.js';

function adapter(result: ConnectorResult | Error): ConnectorAdapter {
  return {
    manifest: { name: 'slack', version: '1', operations: {} },
    execute: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const value = (name: string, labels: Record<string, string> = {}) =>
  operatorSeries(10_000).find(
    (s) => s.name === name && JSON.stringify(s.labels) === JSON.stringify(labels),
  )?.value;

afterEach(() => resetOperatorMetrics());

describe('operator metrics', () => {
  it('has no heartbeat age until a runner has reported, because never is not zero', () => {
    expect(value('lupin_runner_heartbeat_age_seconds')).toBeUndefined();
    recordRunnerHeartbeat(4_000);
    expect(value('lupin_runner_heartbeat_age_seconds')).toBe(6);
  });

  it('counts accepted reporter events and how long ago the last arrived', () => {
    expect(value('lupin_reporter_events_total')).toBe(0);
    expect(value('lupin_reporter_last_event_age_seconds')).toBeUndefined();
    recordReporterEvents(3, 7_000);
    recordReporterEvents(0, 9_000); // nothing accepted moves nothing
    expect(value('lupin_reporter_events_total')).toBe(3);
    expect(value('lupin_reporter_last_event_age_seconds')).toBe(3);
  });

  it('counts a connector call that returned an error and one that threw as failures', async () => {
    const ok = metered(adapter({ status: 'ok', data: {}, attempts: 1 }));
    const refused = metered(
      adapter({
        status: 'error',
        error: { code: 'slack_429', retryable: true, message: 'slow down' },
        attempts: 3,
      }),
    );
    const broken = metered(adapter(new Error('socket hang up')));

    await ok.execute({ operation: 'postMessage', input: {} } as never, 's');
    const answer = await refused.execute({ operation: 'postMessage', input: {} } as never, 's');
    await expect(broken.execute({ operation: 'x', input: {} } as never, 's')).rejects.toThrow(
      'socket hang up',
    );

    // The result passes through unchanged: metering only observes.
    expect(answer.status).toBe('error');
    expect(value('lupin_connector_calls_total', { connector: 'slack' })).toBe(3);
    expect(value('lupin_connector_failures_total', { connector: 'slack' })).toBe(2);
  });

  it('appears in the scrape body beside the process series', () => {
    recordRunnerHeartbeat();
    const body = renderExposition(collect());
    expect(body).toContain('# TYPE lupin_runner_heartbeat_age_seconds gauge');
    expect(body).toContain('# TYPE lupin_reporter_events_total counter');
    expect(body).toContain('process_uptime_seconds');
  });
});
