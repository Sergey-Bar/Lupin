import { ChangeRiskSchema } from '@lupin/shared-contracts';
import { describe, expect, it } from 'vitest';
import {
  CHANGE_RISK_VERSION,
  assessChangeRisk,
  riskBlocks,
  type ChangeRiskInput,
} from './change-risk.js';

/** A small human change with every required reading present and nothing wrong in it. */
function clean(overrides: Partial<ChangeRiskInput> = {}): ChangeRiskInput {
  return {
    attribution: 'human',
    agent: null,
    additions: 40,
    deletions: 10,
    testsTouched: true,
    humanApprovals: 1,
    diffCoverage: 92,
    findings: { high: 0, critical: 0 },
    tests: { total: 120, failed: 0, unexcusedFlaky: 0 },
    evalRegressions: null,
    blastRadius: null,
    tampering: null,
    skippedPhases: [],
    ...overrides,
  };
}

const ids = (input: ChangeRiskInput) =>
  assessChangeRisk(input)
    .factors.filter((factor) => factor.kind === 'risk')
    .map((factor) => `risk:${factor.id}`);

describe('assessChangeRisk', () => {
  it('rates a clean, reviewed, covered human change low', () => {
    const risk = assessChangeRisk(clean());
    expect(risk).toMatchObject({ level: 'low', score: 0, version: CHANGE_RISK_VERSION });
    expect(ChangeRiskSchema.safeParse(risk).success).toBe(true);
  });

  it('rates a 900-line agent change with no tests and no approval high', () => {
    const input = clean({
      attribution: 'agent-authored',
      agent: 'claude-code',
      additions: 800,
      deletions: 100,
      testsTouched: false,
      humanApprovals: 0,
    });
    const risk = assessChangeRisk(input);
    expect(risk.level).toBe('high');
    expect(ids(input)).toEqual([
      'risk:ai-authorship',
      'risk:no-human-approval',
      'risk:size',
      'risk:no-tests-touched',
    ]);
    expect(risk.factors[0]?.detail).toBe('Written by an agent (claude-code).');
  });

  it('rates the same change unknown when its diff coverage was not measured and nothing else is wrong', () => {
    const risk = assessChangeRisk(clean({ diffCoverage: null }));
    expect(risk.level).toBe('unknown');
    expect(risk.missing).toEqual(['diff-coverage']);
    expect(risk.factors).toContainEqual(
      expect.objectContaining({ id: 'diff-coverage', kind: 'missing', points: 0 }),
    );
  });

  it('keeps a measured high level when evidence is also missing: unknown never hides a known risk', () => {
    const risk = assessChangeRisk(
      clean({ tests: null, findings: { high: 0, critical: 1 }, humanApprovals: 0 }),
    );
    expect(risk.level).toBe('high');
    expect(risk.missing).toEqual(['tests']);
  });

  it('makes an agent change that tampers with its tests critical', () => {
    const risk = assessChangeRisk(
      clean({
        attribution: 'agent-authored',
        agent: 'codex',
        tampering: { findings: 2, kinds: ['skip-added', 'assertion-removed'] },
      }),
    );
    expect(risk.level).toBe('critical');
    expect(risk.factors[0]).toMatchObject({ id: 'test-tampering', points: 40 });
    expect(risk.factors[0]?.detail).toBe(
      '2 changes weaken the tests: an added skip or focus, a removed assertion.',
    );
  });

  it('puts a new critical finding at high at least, on a change with nothing else wrong', () => {
    expect(assessChangeRisk(clean({ findings: { high: 0, critical: 1 } })).level).toBe('high');
  });

  it('counts failed and unexcused flaky tests on the commit', () => {
    expect(ids(clean({ tests: { total: 50, failed: 2, unexcusedFlaky: 1 } }))).toEqual([
      'risk:failed-tests',
      'risk:unexcused-flaky',
    ]);
  });

  it('reads a zero-test run as missing test evidence, not a pass', () => {
    const risk = assessChangeRisk(clean({ tests: { total: 0, failed: 0, unexcusedFlaky: 0 } }));
    expect(risk.missing).toEqual(['tests']);
    expect(risk.level).toBe('unknown');
  });

  it('scores the coverage bands and the size bands at their edges', () => {
    const points = (input: ChangeRiskInput, id: string) =>
      assessChangeRisk(input).factors.find((factor) => factor.id === id)?.points ?? 0;
    expect(points(clean({ diffCoverage: 80 }), 'diff-coverage')).toBe(0);
    expect(points(clean({ diffCoverage: 79.9 }), 'diff-coverage')).toBe(10);
    expect(points(clean({ diffCoverage: 49.9 }), 'diff-coverage')).toBe(20);
    expect(points(clean({ additions: 399, deletions: 0 }), 'size')).toBe(0);
    expect(points(clean({ additions: 400, deletions: 0 }), 'size')).toBe(10);
    expect(points(clean({ additions: 1000, deletions: 0 }), 'size')).toBe(20);
  });

  it('does not ask a tiny change to touch tests', () => {
    expect(ids(clean({ additions: 3, deletions: 1, testsTouched: false }))).toEqual([]);
  });

  it('caps blast radius and skipped phases, and names what they are', () => {
    const risk = assessChangeRisk(
      clean({
        blastRadius: { sensitiveAreas: ['auth', 'migrations', 'ci'], truncated: true },
        skippedPhases: ['plan', 'review', 'test'],
      }),
    );
    const blast = risk.factors.find((factor) => factor.id === 'blast-radius');
    expect(blast).toMatchObject({ points: 20 });
    expect(blast?.detail).toBe(
      'Touches 3 sensitive areas: auth, migrations, ci (changed files were truncated, so there may be more).',
    );
    expect(risk.factors.find((factor) => factor.id === 'skipped-phases')).toMatchObject({
      points: 20,
      detail: 'Skipped phases: plan, review, test.',
    });
  });

  it('treats an AI-assisted change with no approval as less than an agent one', () => {
    const assisted = assessChangeRisk(clean({ attribution: 'ai-assisted', humanApprovals: 0 }));
    const agent = assessChangeRisk(clean({ attribution: 'agent-authored', humanApprovals: 0 }));
    expect(assisted.score).toBeLessThan(agent.score);
  });

  it('copies evidence references onto the factors that read them', () => {
    const risk = assessChangeRisk(
      clean({ diffCoverage: 40, evidence: { 'diff-coverage': 'commit:abc1234' } }),
    );
    expect(risk.factors[0]).toMatchObject({ id: 'diff-coverage', evidence: 'commit:abc1234' });
  });

  it('lets a policy require more evidence, and refuses one that requires nothing it knows', () => {
    const risk = assessChangeRisk(clean(), { require: ['tests', 'diff-coverage', 'tampering'] });
    expect(risk.missing).toEqual(['tampering']);
    expect(risk.level).toBe('unknown');
    expect(() => assessChangeRisk(clean(), { require: ['nonsense' as never] })).toThrow(RangeError);
  });

  it('lists optional missing evidence without changing the level', () => {
    const risk = assessChangeRisk(clean({ findings: null }));
    expect(risk.level).toBe('low');
    expect(risk.missing).toEqual([]);
    expect(risk.factors).toContainEqual(
      expect.objectContaining({ id: 'findings', kind: 'missing' }),
    );
  });

  it('refuses a negative or non-finite count', () => {
    expect(() => assessChangeRisk(clean({ additions: -1 }))).toThrow(RangeError);
    expect(() => assessChangeRisk(clean({ diffCoverage: Number.NaN }))).toThrow(RangeError);
  });
});

describe('riskBlocks', () => {
  it('blocks nothing by default', () => {
    expect(riskBlocks('critical', {})).toBe(false);
  });

  it('blocks at or above the policy level', () => {
    expect(riskBlocks('high', { blockAt: 'high' })).toBe(true);
    expect(riskBlocks('critical', { blockAt: 'high' })).toBe(true);
    expect(riskBlocks('medium', { blockAt: 'high' })).toBe(false);
    expect(riskBlocks('high', { blockAt: 'critical' })).toBe(false);
  });

  it('blocks unknown only when the policy says so', () => {
    expect(riskBlocks('unknown', { blockAt: 'high' })).toBe(false);
    expect(riskBlocks('unknown', { blockAt: 'high', blockOnUnknown: true })).toBe(true);
    expect(riskBlocks('unknown', { blockOnUnknown: true })).toBe(false);
  });
});
