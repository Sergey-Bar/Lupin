import { describe, expect, it } from 'vitest';
import { heroVerdict } from './hero.js';
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
