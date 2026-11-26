import { describe, expect, it } from 'vitest';
import {
  ConnectorHttpError,
  ConnectorRejectionError,
  connectorFailure,
  executeWithRetry,
  refusalOf,
  retryAtFrom,
} from './index.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const headers = (value?: string) => ({
  get: (name: string) => (name === 'retry-after' && value !== undefined ? value : null),
});

describe('retryAtFrom', () => {
  it.each([
    ['30', '2026-11-26T12:00:30.000Z'],
    [' 5 ', '2026-11-26T12:00:05.000Z'],
    ['Thu, 26 Nov 2026 12:02:00 GMT', '2026-11-26T12:02:00.000Z'],
  ])('reads %j as %s', (raw, expected) => {
    expect(retryAtFrom(raw, NOW)?.toISOString()).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['0'], ['-3'], ['soon'], ['Thu, 26 Nov 2026 11:00:00 GMT']])(
    'reads %j as no usable time, never as "now"',
    (raw) => {
      expect(retryAtFrom(raw, NOW)).toBeUndefined();
    },
  );
});

describe('refusalOf', () => {
  it('carries the named time on a 429', () => {
    const error = refusalOf({ status: 429, headers: headers('60') }, 'refused', NOW);
    expect(error).toBeInstanceOf(ConnectorRejectionError);
    expect((error as ConnectorRejectionError).retryAt?.toISOString()).toBe(
      '2026-11-26T12:01:00.000Z',
    );
  });

  it('is a plain HTTP error for a 5xx, and tolerates a response with no headers', () => {
    expect(refusalOf({ status: 503 }, 'failed', NOW)).not.toBeInstanceOf(ConnectorRejectionError);
    expect(refusalOf({ status: 503 }, 'failed', NOW)).toBeInstanceOf(ConnectorHttpError);
    expect(
      (refusalOf({ status: 400 }, 'x', NOW) as ConnectorRejectionError).retryAt,
    ).toBeUndefined();
  });
});

describe('a platform that names a time', () => {
  it('is not asked again on the short backoff, and the result says when to come back', async () => {
    let calls = 0;
    const attempt = executeWithRetry(
      async () => {
        calls += 1;
        throw refusalOf({ status: 429, headers: headers('120') }, 'slow down', NOW);
      },
      { retries: 2, idempotent: true, sleep: async () => undefined },
    );
    const error = await attempt.catch((caught: unknown) => caught);
    expect(calls).toBe(1);
    const result = connectorFailure('jira', error, 'Jira operation failed');
    expect(result.error).toMatchObject({
      code: 'jira_rejected_429',
      retryable: true,
      retryAt: '2026-11-26T12:02:00.000Z',
    });
  });

  it('control: a 429 that names no time is still retried on the backoff', async () => {
    let calls = 0;
    await executeWithRetry(
      async () => {
        calls += 1;
        throw refusalOf({ status: 429, headers: headers() }, 'slow down', NOW);
      },
      { retries: 2, idempotent: true, sleep: async () => undefined },
    ).catch(() => undefined);
    expect(calls).toBe(3);
  });
});
