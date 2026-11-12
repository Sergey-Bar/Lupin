import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { ctrfJsonAdapter } from './ctrf-json.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://ctrf',
  sourceDigest: 'c'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-10-01T00:00:00.000Z',
  finishedAt: '2026-10-01T00:05:00.000Z',
};

/** A CTRF report as `playwright-ctrf-json-reporter` writes one, including fields not read. */
const report = {
  reportFormat: 'CTRF',
  specVersion: '0.0.0',
  results: {
    tool: { name: 'playwright', version: '1.50.0' },
    summary: {
      tests: 5,
      passed: 2,
      failed: 1,
      skipped: 1,
      pending: 0,
      other: 1,
      start: 1,
      stop: 2,
    },
    tests: [
      {
        name: 'pays',
        status: 'passed',
        duration: 120,
        filePath: 'tests/pay.spec.ts',
        suite: 'Checkout > Card',
        steps: [
          { name: 'open cart', status: 'passed' },
          { name: 'submit', status: 'passed' },
        ],
      },
      {
        name: 'refunds',
        status: 'failed',
        duration: 80,
        filePath: 'tests/pay.spec.ts',
        message: 'expected 200, got 500',
        trace: 'at refunds (tests/pay.spec.ts:20:5)',
        attachments: [
          { name: 'screenshot', contentType: 'image/png', path: 'test-results/refunds/shot.png' },
        ],
      },
      { name: 'exports', status: 'skipped', duration: 0, filePath: 'tests/export.spec.ts' },
      {
        name: 'retries the payment',
        status: 'passed',
        duration: 300,
        filePath: 'tests/pay.spec.ts',
        flaky: true,
        retries: 1,
        retryAttempts: [{ status: 'failed', duration: 250, message: 'timeout' }],
      },
      { name: 'reconciles', status: 'other', filePath: 'tests/ledger.spec.ts' },
    ],
  },
};

const parse = (document: unknown) =>
  ctrfJsonAdapter.parse(new TextEncoder().encode(JSON.stringify(document)), context);

describe('ctrfJsonAdapter', () => {
  const result = parse(report);
  const byTitle = (title: string) => result.attempts.filter((attempt) => attempt.title === title);

  it('maps each CTRF status, and reads `other` as unknown rather than a pass', () => {
    expect(byTitle('pays')[0]).toMatchObject({
      status: 'passed',
      describePath: ['Checkout', 'Card'],
    });
    expect(byTitle('refunds')[0]).toMatchObject({
      status: 'failed',
      error: { message: 'expected 200, got 500' },
    });
    expect(byTitle('exports')[0]?.status).toBe('skipped');
    expect(byTitle('reconciles')[0]).toMatchObject({ status: 'unknown', rawStatus: 'other' });
    expect(result.status).toBe('failed');
    expect(result.completeness.state).toBe('unknown');
    expect(result.provenance.producer).toBe('ctrf');
  });

  it('keeps retryAttempts as earlier attempts and calls the test flaky', () => {
    expect(
      byTitle('retries the payment').map((attempt) => [attempt.index, attempt.status]),
    ).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ]);
    expect(byTitle('retries the payment')[0]?.flakiness).toBe('observed');
  });

  it('counts `retries` as failed attempts when the attempts themselves are absent', () => {
    const counted = parse({
      results: { tests: [{ name: 'a', status: 'passed', filePath: 'a.spec.ts', retries: 2 }] },
    });
    expect(counted.attempts.map((attempt) => attempt.status)).toEqual([
      'failed',
      'failed',
      'passed',
    ]);
    expect(counted.status).toBe('flaky');
  });

  it('carries steps and attachments by reference, with no bytes invented', () => {
    expect(result.steps.map((step) => step.status)).toEqual(['passed', 'passed']);
    expect(result.steps[1]?.id).toContain('submit');
    const [evidence] = byTitle('refunds')[0]?.evidence ?? [];
    expect(evidence).toMatchObject({
      mediaType: 'image/png',
      byteSize: 0,
      metadata: { path: 'test-results/refunds/shot.png', uploaded: false },
    });
    expect(evidence?.uri).toMatch(/^artifact:\/\/run-1\//u);
  });

  it('refuses a document that is not CTRF', () => {
    expect(() => parse({ testResults: [] })).toThrow('CTRF report has no results.tests array');
    expect(() => ctrfJsonAdapter.parse(new TextEncoder().encode('<xml/>'), context)).toThrow(
      'CTRF report is not valid JSON',
    );
    expect(() => parse({ results: { tests: [] } })).toThrow(/contains no tests/u);
  });
});
