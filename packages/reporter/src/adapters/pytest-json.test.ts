import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { pytestJsonAdapter } from './pytest-json.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://pytest',
  sourceDigest: 'd'.repeat(64),
  producerVersion: '8.3.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-10-01T00:00:00.000Z',
};

const phase = (outcome: string, duration = 0.001) => ({ duration, outcome });

/** pytest-json-report output, with pytest-rerunfailures writing a rerun as its own entry. */
const report = {
  created: 1_790_000_000.5,
  duration: 1.2,
  exitcode: 1,
  root: '/home/ci/repo',
  environment: { Python: '3.12.4' },
  summary: { passed: 2, failed: 1, skipped: 1, rerun: 1, total: 5, collected: 5 },
  collectors: [{ nodeid: '', outcome: 'passed', result: [] }],
  tests: [
    {
      nodeid: 'tests/test_pay.py::TestCard::test_charges',
      lineno: 10,
      outcome: 'passed',
      keywords: ['test_charges'],
      setup: phase('passed'),
      call: phase('passed', 0.02),
      teardown: phase('passed'),
    },
    {
      nodeid: 'tests/test_pay.py::test_declines',
      lineno: 20,
      outcome: 'failed',
      setup: phase('passed'),
      call: {
        duration: 0.01,
        outcome: 'failed',
        crash: {
          path: '/home/ci/repo/tests/test_pay.py',
          lineno: 22,
          message: 'assert 500 == 200',
        },
        longrepr: 'def test_declines():\n>       assert 500 == 200',
      },
      teardown: phase('passed'),
    },
    {
      nodeid: 'tests/test_export.py::test_csv',
      outcome: 'skipped',
      setup: {
        duration: 0,
        outcome: 'skipped',
        longrepr: "('tests/test_export.py', 5, 'Skipped: no s3')",
      },
      teardown: phase('passed'),
    },
    {
      nodeid: 'tests/test_pay.py::test_retry',
      outcome: 'rerun',
      setup: phase('passed'),
      call: { duration: 0.1, outcome: 'failed', crash: { message: 'ConnectionError' } },
    },
    {
      nodeid: 'tests/test_pay.py::test_retry',
      outcome: 'passed',
      setup: phase('passed'),
      call: phase('passed'),
      teardown: phase('passed'),
    },
    { nodeid: 'tests/test_pay.py::test_odd[x]', outcome: 'interrupted' },
  ],
};

const parse = (document: unknown) =>
  pytestJsonAdapter.parse(new TextEncoder().encode(JSON.stringify(document)), context);

describe('pytestJsonAdapter', () => {
  const result = parse(report);
  const attemptsOf = (title: string) =>
    result.attempts.filter((attempt) => attempt.title === title);

  it('reads the node id as file, class, and title, and the phases as the duration', () => {
    expect(attemptsOf('test_charges')[0]).toMatchObject({
      status: 'passed',
      specPath: 'tests/test_pay.py',
      describePath: ['TestCard'],
    });
    expect(attemptsOf('test_charges')[0]?.durationMs).toBeCloseTo(22, 5);
    expect(result.provenance.producer).toBe('pytest');
  });

  it("keeps the failing phase's crash message", () => {
    expect(attemptsOf('test_declines')[0]).toMatchObject({
      status: 'failed',
      error: { message: 'assert 500 == 200' },
    });
  });

  it('reads a skip as skipped and an outcome outside the vocabulary as unknown', () => {
    expect(attemptsOf('test_csv')[0]?.status).toBe('skipped');
    expect(attemptsOf('test_odd[x]')[0]).toMatchObject({
      status: 'unknown',
      rawStatus: 'interrupted',
    });
  });

  it('keeps a rerun as an earlier attempt of the same test', () => {
    expect(attemptsOf('test_retry').map((attempt) => [attempt.index, attempt.status])).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ]);
    expect(attemptsOf('test_retry')[1]?.flakiness).toBe('observed');
  });

  it('carries setup, call and teardown as steps', () => {
    const steps = result.steps.filter((step) => step.id.includes('test_declines'));
    expect(steps.map((step) => step.status)).toEqual(['passed', 'failed', 'passed']);
    expect(steps[1]?.error?.message).toBe('assert 500 == 200');
  });

  it('reports a collection error outside the tests', () => {
    const broken = parse({
      ...report,
      collectors: [
        { nodeid: 'tests/test_bad.py', outcome: 'failed', longrepr: 'ImportError: no x' },
      ],
    });
    expect(broken.reportErrors).toEqual([{ message: 'tests/test_bad.py: ImportError: no x' }]);
  });

  it('refuses a document that is not a pytest-json-report', () => {
    expect(() => parse({ results: [] })).toThrow('pytest-json-report has no tests array');
  });
});
