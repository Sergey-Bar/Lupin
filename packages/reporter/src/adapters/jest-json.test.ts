import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { jestJsonAdapter } from './jest-json.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://jest',
  sourceDigest: 'a'.repeat(64),
  producerVersion: '29.7.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-10-01T00:00:00.000Z',
};

const ESC = String.fromCharCode(27);

/** `jest --json` output, trimmed to two files, with the fields Jest writes but this ignores. */
const JEST_REPORT = {
  numFailedTestSuites: 1,
  numPassedTests: 1,
  numTotalTests: 5,
  startTime: 1_790_000_000_000,
  success: false,
  testResults: [
    {
      name: '/home/ci/repo/src/cart.test.ts',
      status: 'failed',
      message: '',
      startTime: 1_790_000_000_000,
      endTime: 1_790_000_000_400,
      assertionResults: [
        {
          ancestorTitles: ['cart', 'totals'],
          fullName: 'cart totals adds tax',
          title: 'adds tax',
          status: 'passed',
          duration: 4,
          failureMessages: [],
          location: null,
        },
        {
          ancestorTitles: ['cart'],
          fullName: 'cart removes an item',
          title: 'removes an item',
          status: 'failed',
          duration: 9,
          failureMessages: [
            `${ESC}[31mError: expected 1 to be 0${ESC}[39m\n    at cart.test.ts:20`,
          ],
        },
        {
          ancestorTitles: ['cart'],
          title: 'applies a coupon',
          status: 'pending',
          failureMessages: [],
        },
        { ancestorTitles: ['cart'], title: 'ships abroad', status: 'todo', failureMessages: [] },
        { ancestorTitles: ['cart'], title: 'runs focused', status: 'focused', failureMessages: [] },
      ],
    },
    {
      name: '/home/ci/repo/src/broken.test.ts',
      status: 'failed',
      message: 'Cannot find module ./missing',
      assertionResults: [],
    },
  ],
};

const parse = (document: unknown) =>
  jestJsonAdapter.parse(new TextEncoder().encode(JSON.stringify(document)), context);

describe('jestJsonAdapter', () => {
  const result = parse(JEST_REPORT);
  const byTitle = (title: string) => result.attempts.find((attempt) => attempt.title === title);

  it('reads each assertion as a test under its file and describe path', () => {
    expect(byTitle('adds tax')).toMatchObject({
      status: 'passed',
      specPath: 'home/ci/repo/src/cart.test.ts',
      describePath: ['cart', 'totals'],
      durationMs: 4,
    });
    expect(result.provenance.producer).toBe('jest');
  });

  it('keeps the failure message without its colour codes', () => {
    expect(byTitle('removes an item')).toMatchObject({ status: 'failed', rawStatus: 'failed' });
    expect(byTitle('removes an item')?.error?.message).toBe(
      'Error: expected 1 to be 0\n    at cart.test.ts:20',
    );
  });

  it('reads pending and todo as skipped, and a status with no outcome as unknown', () => {
    expect(byTitle('applies a coupon')?.status).toBe('skipped');
    expect(byTitle('ships abroad')?.status).toBe('skipped');
    expect(byTitle('runs focused')?.status).toBe('unknown');
    expect(
      parse({ testResults: [{ name: 'a.test.ts', assertionResults: [{ title: 'x' }] }] }).status,
    ).toBe('unknown');
  });

  it('records one attempt per test, since Jest keeps no retry history', () => {
    expect(result.attempts.every((attempt) => attempt.index === 1)).toBe(true);
  });

  it('reports a file that failed to run as an error outside the tests', () => {
    expect(result.reportErrors).toEqual([
      { message: 'home/ci/repo/src/broken.test.ts: Cannot find module ./missing' },
    ]);
  });

  it('refuses a document that is not a Jest report', () => {
    expect(() => parse({ results: { tests: [] } })).toThrow(
      'Jest JSON report has no testResults array',
    );
    expect(() => parse([])).toThrow('Jest JSON report has no testResults array');
  });
});
