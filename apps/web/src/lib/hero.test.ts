import { describe, expect, it } from 'vitest';
import { heroVerdict, runHero } from './hero.js';
import type { ReleaseReadinessCard } from './qa.js';

const card = (
  verdict: ReleaseReadinessCard['verdict'],
  reasons: { level: 'no-go' | 'caution' | 'unknown' | 'go'; message: string }[] = [],
): ReleaseReadinessCard =>
  ({
    verdict,
    reasons: reasons.map((reason) => ({ code: 'x', evidence: '', ...reason })),
  }) as unknown as ReleaseReadinessCard;

describe('heroVerdict', () => {
  it('says no-go with the reason that blocks, and opens what is blocking', () => {
    expect(
      heroVerdict(
        card('no-go', [
          { level: 'caution', message: 'Flaky at 2%' },
          { level: 'no-go', message: 'Pass rate 73.5% is below the 80% floor' },
        ]),
      ),
    ).toEqual({
      verdict: 'no-go',
      word: 'No-go',
      reason: 'Pass rate 73.5% is below the 80% floor',
      action: { label: 'See what is blocking', to: '/dashboard' },
    });
  });

  it('says caution with the first warning', () => {
    expect(
      heroVerdict(card('caution', [{ level: 'caution', message: 'Flaky at 2%' }])),
    ).toMatchObject({
      verdict: 'caution',
      word: 'Caution',
      reason: 'Flaky at 2%',
      action: { label: 'Review the warnings' },
    });
  });

  it('says ready when every gate passes, and offers the runs', () => {
    expect(heroVerdict(card('go'))).toEqual({
      verdict: 'go',
      word: 'Ready',
      reason: 'Every release gate passes.',
      action: { label: 'See the runs', to: '/dashboard/runs' },
    });
  });

  it('never claims ready when nothing was measured', () => {
    expect(heroVerdict(null)).toMatchObject({ verdict: 'unknown', word: 'Not measured' });
  });
});

describe('runHero', () => {
  const run = (overrides: Record<string, unknown>) =>
    ({
      phase: 'complete',
      outcome: 'passed',
      tests: [],
      summary: { total: 10, passed: 10, failed: 0 },
      ...overrides,
    }) as never;

  it('counts a running run live, never as a verdict', () => {
    expect(
      runHero(
        run({ phase: 'running', outcome: null, summary: { total: 10, passed: 3, failed: 1 } }),
      ),
    ).toEqual({
      verdict: 'unknown',
      word: 'Running',
      reason: '4 of 10 tests reported · 1 failing so far',
      failed: 1,
    });
  });

  it('settles into the verdict when the run ends', () => {
    expect(runHero(run({}))).toMatchObject({
      verdict: 'go',
      word: 'Passed',
      reason: 'All 10 tests passed.',
    });
    expect(
      runHero(
        run({
          outcome: 'failed',
          summary: { total: 10, passed: 8, failed: 2 },
          tests: [
            { id: 'a', status: 'failed' },
            { id: 'b', status: 'timed_out' },
            { id: 'c', status: 'passed' },
          ],
        }),
      ),
    ).toEqual({ verdict: 'no-go', word: 'Failed', reason: '2 of 10 tests failed.', failed: 2 });
  });
});
