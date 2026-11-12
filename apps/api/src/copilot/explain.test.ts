import { describe, expect, it } from 'vitest';
import type { ExecutionRun, ExecutionTestResult } from '../execution/types.js';
import { explainRun } from './explain.js';

function test(
  id: string,
  status: ExecutionTestResult['status'],
  message?: string,
): ExecutionTestResult {
  return {
    id,
    title: `checkout › ${id}`,
    file: 'e2e/checkout.spec.ts',
    status,
    durationMs: 100,
    ...(message === undefined ? {} : { error: { code: 'ASSERTION_FAILED', message } }),
  };
}

function run(tests: ExecutionTestResult[], extra: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: 'run-1',
    outcome: 'failed',
    phase: 'complete',
    branch: 'feat/checkout',
    tests,
    summary: {
      total: tests.length,
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status === 'failed').length,
      flaky: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: null,
    },
    ...extra,
  } as ExecutionRun;
}

describe('explainRun, the copilot rule engine', () => {
  it('names the biggest cause first, with counts taken from the run itself', () => {
    const answer = explainRun(
      run([
        test('a', 'failed', 'expected the cart to settle within 5000ms'),
        test('b', 'failed', 'expected the cart to settle within 3000ms'),
        test('c', 'failed', 'card was declined'),
        test('d', 'passed'),
      ]),
    );
    expect(answer.source).toBe('rules');
    expect(answer.summary).toBe(
      '3 of 4 tests failed on feat/checkout, from 2 causes. The biggest, in 2 tests: "expected the cart to settle within 5000ms".',
    );
    expect(answer.causes.map((cause) => [cause.count, cause.tests])).toEqual([
      [2, ['a', 'b']],
      [1, ['c']],
    ]);
  });

  it('cites every test it talks about, and nothing it did not read', () => {
    const answer = explainRun(run([test('a', 'failed', 'boom'), test('z', 'passed')]));
    expect(answer.citations).toEqual([
      { kind: 'run', id: 'run-1' },
      { kind: 'test', id: 'a', runId: 'run-1' },
    ]);
  });

  it('proposes the retry of what failed, and quarantine only for a test that also passed', () => {
    const answer = explainRun(
      run([test('a', 'failed', 'boom'), { ...test('f', 'flaky'), error: undefined }]),
    );
    expect(answer.actions).toEqual([
      { kind: 'retry', runId: 'run-1', scope: 'failed', label: 'Retry the 1 failed test' },
      {
        kind: 'quarantine',
        testId: 'f',
        // The quarantine route needs the title and file, so the action carries them.
        testTitle: 'checkout › f',
        testFile: 'e2e/checkout.spec.ts',
        runId: 'run-1',
        label: 'Quarantine checkout › f',
      },
    ]);
  });

  it('says it does not know rather than guessing, when a failed run reported no tests', () => {
    const answer = explainRun(run([], { error: null }));
    expect(answer.summary).toBe(
      'The run failed before it reported any tests, and it left no error to explain why.',
    );
    expect(answer.causes).toEqual([]);
    expect(answer.actions).toEqual([]);
  });

  it('says a passing run passed, and proposes nothing', () => {
    const answer = explainRun(run([test('a', 'passed')], { outcome: 'passed' }));
    expect(answer.summary).toBe('All 1 tests passed on feat/checkout.');
    expect(answer.actions).toEqual([]);
  });

  it('redacts a secret in an error message before it is quoted', () => {
    const token = ['ghp', 'A'.repeat(36)].join('_');
    const answer = explainRun(run([test('a', 'failed', `auth failed for ${token}`)]));
    expect(JSON.stringify(answer)).not.toContain(token);
    expect(answer.causes[0]?.message).toBe('auth failed for [redacted]');
  });
});

describe('explainRun owners', () => {
  it('names who owns each cause, from the files of its tests', () => {
    const answer = explainRun(
      run([
        test('a', 'failed', 'boom'),
        { ...test('b', 'failed', 'boom'), file: 'e2e/pay.spec.ts' },
      ]),
      (file) => (file === 'e2e/pay.spec.ts' ? '@payments' : file === null ? null : '@web'),
    );
    expect(answer.causes[0]?.owners).toEqual(['@web', '@payments']);
  });

  it('leaves owners empty when nothing owns the files, or no lookup is given', () => {
    expect(explainRun(run([test('a', 'failed', 'boom')]), () => null).causes[0]?.owners).toEqual(
      [],
    );
    expect(explainRun(run([test('a', 'failed', 'boom')])).causes[0]?.owners).toEqual([]);
  });
});
