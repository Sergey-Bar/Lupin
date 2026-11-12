import type { PullRequestRisk } from '@lupin/shared-contracts';
import { RISK_BADGE, isHighRisk, pullRequestRiskPath, riskHero, riskyPull } from './change-risk.js';

const assessed = (risk: Partial<PullRequestRisk['risk']>): PullRequestRisk => ({
  pullRequest: 12,
  headSha: 'b'.repeat(40),
  assessedAt: '2026-11-11T09:00:00.000Z',
  blastRadius: null,
  risk: { level: 'low', score: 0, version: 'change-risk/1', factors: [], missing: [], ...risk },
});

describe('riskHero', () => {
  it('leads with the factor worth the most, as the assessment wrote it', () => {
    expect(
      riskHero(
        assessed({
          level: 'critical',
          score: 80,
          factors: [
            {
              id: 'diff-coverage',
              kind: 'missing',
              points: 0,
              detail: 'Not measured.',
              evidence: null,
            },
            { id: 'test-tampering', kind: 'risk', points: 40, detail: 'A skip.', evidence: null },
          ],
        }),
      ),
    ).toEqual({ verdict: 'no-go', word: 'Critical risk', reason: 'A skip.' });
  });

  it('says what was not measured for an unknown risk, never calling it low', () => {
    expect(riskHero(assessed({ level: 'unknown', missing: ['tests', 'diff-coverage'] }))).toEqual({
      verdict: 'unknown',
      word: 'Risk unknown',
      reason:
        'Not measured: test results, diff coverage. Until it is, this change cannot be called low risk.',
    });
  });

  it('says nothing raises a low risk', () => {
    expect(riskHero(assessed({})).reason).toBe('Nothing measured raises this change’s risk.');
    expect(riskHero(assessed({ level: 'medium' })).verdict).toBe('caution');
  });
});

describe('the rest', () => {
  it('ranks high and critical as high, and keeps unknown neutral', () => {
    expect(
      ['low', 'medium', 'unknown', 'high', 'critical'].map((level) => isHighRisk(level as never)),
    ).toEqual([false, false, false, true, true]);
    expect(RISK_BADGE.unknown).toBe('secondary');
  });

  it('builds the risk page path with the project encoded', () => {
    expect(pullRequestRiskPath('a/b', 7)).toBe('/dashboard/prs/a%2Fb/7');
  });

  it('calls a pull request risky only at its current head, open and not a draft', () => {
    const pull = (overrides: Record<string, unknown>) =>
      ({
        state: 'open',
        draft: false,
        risk: { level: 'high', score: 50, headSha: 'b', assessedAt: 'x', current: true },
        ...overrides,
      }) as never;
    expect(riskyPull(pull({}))).toBe(true);
    expect(riskyPull(pull({ state: 'merged' }))).toBe(false);
    expect(riskyPull(pull({ risk: undefined }))).toBe(false);
  });
});
