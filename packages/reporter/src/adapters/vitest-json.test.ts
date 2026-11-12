import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { vitestJsonAdapter } from './vitest-json.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://vitest',
  sourceDigest: 'b'.repeat(64),
  producerVersion: '3.2.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-10-01T00:00:00.000Z',
};

/** Vitest `--reporter=json`, which writes the Jest shape plus `meta`. */
const report = {
  numTotalTests: 5,
  success: false,
  testResults: [
    {
      name: 'C:\\ci\\repo\\src\\pay.test.ts',
      status: 'failed',
      message: '',
      assertionResults: [
        {
          ancestorTitles: ['pay'],
          title: 'charges',
          status: 'passed',
          duration: 2,
          failureMessages: [],
          meta: {},
        },
        {
          ancestorTitles: ['pay'],
          title: 'declines',
          status: 'failed',
          duration: 3,
          failureMessages: ['AssertionError: expected false to be true'],
          meta: {},
        },
        {
          ancestorTitles: ['pay'],
          title: 'refunds',
          status: 'skipped',
          failureMessages: [],
          meta: {},
        },
        {
          ancestorTitles: ['pay'],
          title: 'retries',
          status: 'passed',
          retryCount: 2,
          failureMessages: [],
          meta: {},
        },
        {
          ancestorTitles: ['pay'],
          title: 'mystery',
          status: 'running',
          failureMessages: [],
          meta: {},
        },
      ],
    },
  ],
};

const parse = (document: unknown) =>
  vitestJsonAdapter.parse(new TextEncoder().encode(JSON.stringify(document)), context);

describe('vitestJsonAdapter', () => {
  const result = parse(report);
  const attemptsOf = (title: string) =>
    result.attempts.filter((attempt) => attempt.title === title);

  it('maps pass, failure with message, and skip, under a path with the drive removed', () => {
    expect(attemptsOf('charges')[0]).toMatchObject({
      status: 'passed',
      specPath: 'ci/repo/src/pay.test.ts',
    });
    expect(attemptsOf('declines')[0]).toMatchObject({
      status: 'failed',
      error: { message: 'AssertionError: expected false to be true' },
    });
    expect(attemptsOf('refunds')[0]?.status).toBe('skipped');
    expect(result.provenance.producer).toBe('vitest');
  });

  it('keeps `retryCount` as failed attempts before the last, and calls the test flaky', () => {
    expect(attemptsOf('retries').map((attempt) => attempt.status)).toEqual([
      'failed',
      'failed',
      'passed',
    ]);
    expect(attemptsOf('retries')[2]?.flakiness).toBe('observed');
  });

  it('reads a status outside its vocabulary as unknown', () => {
    expect(attemptsOf('mystery')[0]).toMatchObject({ status: 'unknown', rawStatus: 'running' });
  });

  it('refuses a document that is not a Vitest report', () => {
    expect(() => parse({ tests: [] })).toThrow('Vitest JSON report has no testResults array');
  });
});
