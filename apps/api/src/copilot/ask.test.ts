import { describe, expect, it } from 'vitest';
import type { ExecutionRun, ExecutionTestResult } from '../execution/types.js';
import { answerQuestion } from './ask.js';

function t(id: string, status: ExecutionTestResult['status']): ExecutionTestResult {
  return { id, title: `checkout › ${id}`, file: 'e2e/c.spec.ts', status, durationMs: 1 };
}

function run(
  id: string,
  outcome: string,
  minute: number,
  tests: ExecutionTestResult[],
  branch = 'main',
) {
  return {
    id,
    outcome,
    phase: 'complete',
    branch,
    createdAt: `2026-11-09T10:${String(minute).padStart(2, '0')}:00.000Z`,
    tests,
    summary: {
      total: tests.length,
      passed: tests.filter((x) => x.status === 'passed').length,
      failed: tests.filter((x) => x.status === 'failed').length,
      flaky: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: null,
    },
  } as unknown as ExecutionRun;
}

const RUNS = [
  run('r3', 'failed', 3, [t('pay', 'failed'), t('login', 'passed')]),
  run('r2', 'passed', 2, [t('pay', 'passed'), t('login', 'flaky')]),
  run('r1', 'passed', 1, [t('pay', 'passed'), t('cart', 'flaky')], 'feat/x'),
];

describe('answerQuestion, the copilot ask rule engine', () => {
  it('answers what is failing from the newest red run, and cites it', () => {
    const answer = answerQuestion('why is it failing?', RUNS);
    expect(answer.answer).toContain('1 of 2 tests failed');
    expect(answer.citations).toContainEqual({ kind: 'run', id: 'r3' });
    expect(answer.links[0]).toEqual({ label: 'Open the run', to: '/dashboard/runs/r3' });
  });

  it('counts flaky tests across the runs it read, naming each', () => {
    const answer = answerQuestion('which tests are flaky', RUNS);
    expect(answer.answer).toMatch(/^2 tests were flaky in the last 3 runs/u);
    expect(answer.citations.filter((c) => c.kind === 'test').map((c) => c.id)).toEqual([
      'login',
      'cart',
    ]);
  });

  it('says whether the newest run on main passed, for a release question', () => {
    const answer = answerQuestion('can we ship?', RUNS);
    expect(answer.answer).toContain('The newest run on main failed');
    expect(answer.citations).toContainEqual({ kind: 'run', id: 'r3' });
  });

  it('claims nothing it cannot ground, and says what it can answer', () => {
    const answer = answerQuestion('what is the weather', RUNS);
    expect(answer.citations).toEqual([]);
    expect(answer.answer).toMatch(/can answer/u);
  });

  it('says there are no runs rather than guessing', () => {
    expect(answerQuestion('why is it failing', []).answer).toMatch(/no runs/u);
  });
});
