import { describe, expect, it } from 'vitest';
import {
  CHANGE_RISK_LEVELS,
  ChangeRiskFactorSchema,
  ChangeRiskSchema,
  changeRiskRank,
  type ChangeRisk,
} from './change-risk.js';

const assessed: ChangeRisk = {
  level: 'high',
  score: 50,
  version: 'change-risk/1',
  factors: [
    {
      id: 'ai-authorship',
      kind: 'risk',
      points: 15,
      detail: 'Written by an agent (claude-code).',
      evidence: 'pull-request:12',
    },
    { id: 'size', kind: 'risk', points: 10, detail: '900 lines changed.', evidence: null },
    {
      id: 'no-human-approval',
      kind: 'risk',
      points: 15,
      detail: 'No person has approved it.',
      evidence: null,
    },
    {
      id: 'no-tests-touched',
      kind: 'risk',
      points: 10,
      detail: 'No test file among the changes.',
      evidence: null,
    },
  ],
  missing: [],
};

describe('the change-risk contract', () => {
  it('accepts an assessment whose score is the sum of its factors', () => {
    expect(ChangeRiskSchema.safeParse(assessed).success).toBe(true);
  });

  it('refuses a score that is not the sum of the factor points', () => {
    const result = ChangeRiskSchema.safeParse({ ...assessed, score: 51 });
    expect(result.success).toBe(false);
  });

  it('refuses a missing-evidence factor that carries points', () => {
    const result = ChangeRiskFactorSchema.safeParse({
      id: 'diff-coverage',
      kind: 'missing',
      points: 5,
      detail: 'Diff coverage was not measured.',
      evidence: null,
    });
    expect(result.success).toBe(false);
  });

  it('refuses a low level while required evidence is missing', () => {
    const result = ChangeRiskSchema.safeParse({
      ...assessed,
      level: 'low',
      score: 0,
      factors: [
        {
          id: 'diff-coverage',
          kind: 'missing',
          points: 0,
          detail: 'Diff coverage was not measured.',
          evidence: null,
        },
      ],
      missing: ['diff-coverage'],
    });
    expect(result.success).toBe(false);
  });

  it('ranks unknown above medium and below high', () => {
    const ranked = [...CHANGE_RISK_LEVELS].sort((a, b) => changeRiskRank(a) - changeRiskRank(b));
    expect(ranked).toEqual(['low', 'medium', 'unknown', 'high', 'critical']);
  });
});
