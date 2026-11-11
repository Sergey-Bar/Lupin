import { changeRiskRank } from '@lupin/shared-contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assessChangeRisk, type ChangeRiskInput } from './change-risk.js';

/**
 * Property suite for RISK-1, RISK-2 and RISK-3.
 *
 * Fixed seed and `numRuns`, so a red run reproduces on any host. "More risk evidence" is
 * generated as a second input that is the first one made worse on every axis at once — more
 * lines, lower coverage, more findings, more failures, fewer approvals, more tampering — with
 * the same evidence present or missing, so the only thing that changed is the risk.
 */
const SEED = 20261111;
const params = { seed: SEED, numRuns: 500 } as const;

const input: fc.Arbitrary<ChangeRiskInput> = fc.record({
  attribution: fc.constantFrom(
    'human' as const,
    'ai-assisted' as const,
    'agent-authored' as const,
    'unknown' as const,
  ),
  agent: fc.option(fc.constantFrom('claude-code', 'codex', 'copilot'), { nil: null }),
  additions: fc.nat({ max: 3000 }),
  deletions: fc.nat({ max: 3000 }),
  testsTouched: fc.boolean(),
  humanApprovals: fc.nat({ max: 3 }),
  diffCoverage: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
  findings: fc.option(fc.record({ high: fc.nat({ max: 5 }), critical: fc.nat({ max: 5 }) }), {
    nil: null,
  }),
  tests: fc.option(
    fc.record({
      total: fc.nat({ max: 500 }),
      failed: fc.nat({ max: 20 }),
      unexcusedFlaky: fc.nat({ max: 20 }),
    }),
    { nil: null },
  ),
  evalRegressions: fc.option(fc.nat({ max: 5 }), { nil: null }),
  blastRadius: fc.option(
    fc.record({
      sensitiveAreas: fc.subarray(['auth', 'migrations', 'ci', 'infra', 'dependencies']),
      truncated: fc.boolean(),
    }),
    { nil: null },
  ),
  tampering: fc.option(
    fc.record({ findings: fc.nat({ max: 5 }), kinds: fc.constant(['skip-added' as const]) }),
    { nil: null },
  ),
  skippedPhases: fc.subarray(['plan', 'test', 'review']),
});

/** The same change, worse on every axis, with the same evidence present. */
function worse(base: ChangeRiskInput, step: number): ChangeRiskInput {
  return {
    ...base,
    attribution: base.attribution === 'human' ? 'agent-authored' : base.attribution,
    additions: base.additions + step * 100,
    testsTouched: step > 0 ? false : base.testsTouched,
    humanApprovals: Math.max(0, base.humanApprovals - step),
    diffCoverage: base.diffCoverage === null ? null : Math.max(0, base.diffCoverage - step * 10),
    findings:
      base.findings === null
        ? null
        : { high: base.findings.high + step, critical: base.findings.critical },
    tests:
      base.tests === null
        ? null
        : // A run with no tests stays one: giving it tests would add evidence, not risk.
          base.tests.total === 0
          ? base.tests
          : { ...base.tests, failed: base.tests.failed + step, total: base.tests.total + step },
    evalRegressions: base.evalRegressions === null ? null : base.evalRegressions + step,
    tampering:
      base.tampering === null
        ? null
        : { findings: base.tampering.findings + step, kinds: base.tampering.kinds },
  };
}

/** Required by default: test results and diff coverage. */
function missesRequired(value: ChangeRiskInput): boolean {
  return value.diffCoverage === null || value.tests === null || value.tests.total === 0;
}

/**
 * Otherwise-clean changes: small, human, reviewed, covered, passing. The only thing between
 * one of them and `low` is a missing reading, which is where a wrong model would show itself —
 * a random change is rarely clean enough to be `low`, so a property over `input` alone passed
 * with the missing-evidence rule deleted.
 */
const unmeasured: fc.Arbitrary<ChangeRiskInput> = fc.record({
  attribution: fc.constant('human' as const),
  agent: fc.constant(null),
  additions: fc.nat({ max: 40 }),
  deletions: fc.nat({ max: 9 }),
  testsTouched: fc.constant(true),
  humanApprovals: fc.integer({ min: 1, max: 3 }),
  diffCoverage: fc.option(fc.double({ min: 80, max: 100, noNaN: true }), { nil: null }),
  findings: fc.constant({ high: 0, critical: 0 }),
  tests: fc.option(
    fc.constantFrom(
      { total: 10, failed: 0, unexcusedFlaky: 0 },
      { total: 0, failed: 0, unexcusedFlaky: 0 },
    ),
    { nil: null },
  ),
  evalRegressions: fc.constant(null),
  blastRadius: fc.constant(null),
  tampering: fc.constant({ findings: 0, kinds: [] }),
  skippedPhases: fc.constant([]),
});

describe('RISK-1: adding risk evidence never lowers the level', () => {
  it('holds for any change made worse on every axis', () => {
    fc.assert(
      fc.property(input, fc.integer({ min: 1, max: 5 }), (base, step) => {
        const before = assessChangeRisk(base);
        const after = assessChangeRisk(worse(base, step));
        expect(changeRiskRank(after.level)).toBeGreaterThanOrEqual(changeRiskRank(before.level));
        expect(after.score).toBeGreaterThanOrEqual(before.score);
      }),
      params,
    );
  });

  it('pins the agent change that tampers: critical whatever else is true of it', () => {
    const base: ChangeRiskInput = {
      attribution: 'agent-authored',
      agent: 'codex',
      additions: 1,
      deletions: 0,
      testsTouched: true,
      humanApprovals: 2,
      diffCoverage: 100,
      findings: { high: 0, critical: 0 },
      tests: { total: 10, failed: 0, unexcusedFlaky: 0 },
      evalRegressions: null,
      blastRadius: null,
      tampering: { findings: 1, kinds: ['skip-added'] },
      skippedPhases: [],
    };
    expect(assessChangeRisk(base).level).toBe('critical');
    expect(assessChangeRisk(worse(base, 3)).level).toBe('critical');
  });
});

describe('RISK-2: missing required evidence is never low', () => {
  it('holds for any change with tests or diff coverage unmeasured', () => {
    fc.assert(
      fc.property(
        fc.oneof(input, unmeasured).filter((value) => missesRequired(value)),
        (value) => {
          const risk = assessChangeRisk(value);
          expect(risk.level).not.toBe('low');
          expect(risk.level).not.toBe('medium');
          expect(risk.missing.length).toBeGreaterThan(0);
        },
      ),
      params,
    );
  });

  it('pins the emptiest change: nothing measured at all', () => {
    const risk = assessChangeRisk({
      attribution: 'unknown',
      agent: null,
      additions: 0,
      deletions: 0,
      testsTouched: false,
      humanApprovals: 0,
      diffCoverage: null,
      findings: null,
      tests: null,
      evalRegressions: null,
      blastRadius: null,
      tampering: null,
      skippedPhases: [],
    });
    expect(risk.level).toBe('unknown');
  });
});

describe('RISK-3: the score is the sum of the factor points', () => {
  it('holds for any change', () => {
    fc.assert(
      fc.property(input, (value) => {
        const risk = assessChangeRisk(value);
        const sum = risk.factors.reduce((total, factor) => total + factor.points, 0);
        expect(risk.score).toBe(sum);
        for (const factor of risk.factors) {
          if (factor.kind === 'missing') expect(factor.points).toBe(0);
        }
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes a model that reads unmeasured coverage as full coverage', () => {
    // The tempting shortcut — default a missing reading to the good value — must be caught.
    const optimistic = (value: ChangeRiskInput) =>
      assessChangeRisk({
        ...value,
        diffCoverage: value.diffCoverage ?? 100,
        tests:
          value.tests === null || value.tests.total === 0
            ? { total: 1, failed: 0, unexcusedFlaky: 0 }
            : value.tests,
      });
    // Otherwise-clean changes, so the only thing between them and `low` is the missing reading.
    const outcome = fc.check(
      fc.property(
        unmeasured.filter((value) => missesRequired(value)),
        (value) => optimistic(value).level !== 'low',
      ),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
