import {
  CHANGE_RISK_EVIDENCE,
  changeRiskRank,
  type ChangeRisk,
  type ChangeRiskEvidence,
  type ChangeRiskFactor,
  type ChangeRiskFactorId,
  type ChangeRiskLevel,
  type TestTamperKind,
} from '@lupin/shared-contracts';
import type { Attribution } from './ai-attribution.js';

/**
 * How much a pull request should worry the person who has to let it in.
 *
 * Pure. The score is the sum of published points, one row per factor in {@link POINTS}, and
 * every factor carries a sentence a reader can check against the pull request — so the number
 * is a total, not a judgement, and anyone can add it up. That is the line between this and the
 * "invented score" `cockpit-risk.ts` declines: the table is versioned, and an assessment made
 * with another version is not compared with this one.
 *
 * Missing evidence is never safety. Required evidence that is absent (test results and diff
 * coverage, by default) holds the level at `unknown` at best; a change that is already measured
 * `high` or `critical` keeps that level, so a missing reading can never hide a known risk.
 * Optional evidence that is absent is listed, with the step that would supply it, and scores
 * nothing.
 */

/** The points table. Bump it whenever a weight, a band or a threshold changes. */
export const CHANGE_RISK_VERSION = 'change-risk/1';

/**
 * The weights, in points. Chosen so the cases a QA lead names first land where they would put
 * them: an unreviewed agent change of 900 lines with no tests is `high`; one new critical
 * finding is `high` on its own; an agent change that weakens its own tests is `critical`.
 */
export const POINTS = {
  agentAuthored: 15,
  aiAssisted: 5,
  noApprovalAi: 15,
  noApprovalOther: 5,
  /** Lines added plus deleted: the same 400 as `LARGE_CHANGE_LINES` in the cockpit. */
  sizeLarge: { lines: 400, points: 10 },
  sizeVeryLarge: { lines: 1000, points: 20 },
  /** A change this small is not asked to touch a test file. */
  noTestsTouched: { minLines: 50, points: 10 },
  /** Diff coverage in percent: below 50 and below 80. */
  coverageLow: { below: 50, points: 20 },
  coverageMid: { below: 80, points: 10 },
  newCritical: 40,
  newHigh: 20,
  failedTests: 30,
  unexcusedFlaky: 10,
  evalRegression: 20,
  perSensitiveArea: 10,
  sensitiveAreaCap: 20,
  testTampering: 40,
  perSkippedPhase: 10,
  skippedPhaseCap: 20,
} as const;

/** Score bands: below 20 is low, below 40 medium, below 70 high, and 70 or more critical. */
export const LEVEL_BANDS = { medium: 20, high: 40, critical: 70 } as const;

/** Required unless a policy says otherwise: what the change was tested with, and how much. */
export const DEFAULT_REQUIRED_EVIDENCE: readonly ChangeRiskEvidence[] = ['tests', 'diff-coverage'];

export interface ChangeRiskInput {
  attribution: Attribution;
  agent: string | null;
  additions: number;
  deletions: number;
  testsTouched: boolean;
  /** Distinct approvers who are neither the author nor a bot. */
  humanApprovals: number;
  /** Percent, 0–100; `null` when it was not measured. */
  diffCoverage: number | null;
  /** New findings the change adds; `null` when no scan was read. */
  findings: { high: number; critical: number } | null;
  /** The commit's test run, after quarantine; `null` when no run was read. */
  tests: { total: number; failed: number; unexcusedFlaky: number } | null;
  /** Eval suites that regressed; `null` when the project runs no evals. */
  evalRegressions: number | null;
  blastRadius: { sensitiveAreas: readonly string[]; truncated: boolean } | null;
  /** What `lupin diff-guard` found; `null` when it did not run. */
  tampering: { findings: number; kinds: readonly TestTamperKind[] } | null;
  /** SDLC phases the change went past without doing. */
  skippedPhases: readonly string[];
  /** Where each kind of evidence was read from, copied onto the factors that use it. */
  evidence?: Partial<Record<ChangeRiskEvidence, string>>;
}

export interface ChangeRiskPolicy {
  /** The evidence without which a change is never `low`. Default {@link DEFAULT_REQUIRED_EVIDENCE}. */
  require?: readonly ChangeRiskEvidence[];
  /** The level at which the gate fails. `null` or unset: the risk is reported, never blocking. */
  blockAt?: 'high' | 'critical' | null;
  /** Whether an `unknown` level fails a gate that blocks at all. Default `false`. */
  blockOnUnknown?: boolean;
}

const TAMPER_LABEL: Readonly<Record<TestTamperKind, string>> = {
  'test-deleted': 'a deleted test file',
  'skip-added': 'an added skip or focus',
  'assertion-removed': 'a removed assertion',
  'assertion-loosened': 'a loosened assertion',
  'empty-catch': 'an empty catch in a test',
  'snapshot-bulk-update': 'a bulk snapshot update',
  'threshold-lowered': 'a lowered coverage threshold',
  'ci-made-non-failing': 'a CI step made unable to fail',
  'retry-added': 'an added retry',
};

/** The order factors of equal points are listed in: the one a reader should act on first. */
const FACTOR_ORDER: readonly ChangeRiskFactorId[] = [
  'test-tampering',
  'new-findings',
  'failed-tests',
  'ai-authorship',
  'no-human-approval',
  'diff-coverage',
  'size',
  'no-tests-touched',
  'blast-radius',
  'skipped-phases',
  'eval-regression',
  'unexcused-flaky',
];

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

function validate(input: ChangeRiskInput, policy: ChangeRiskPolicy): void {
  const counts: Array<[string, number]> = [
    ['additions', input.additions],
    ['deletions', input.deletions],
    ['humanApprovals', input.humanApprovals],
  ];
  if (input.findings !== null) {
    counts.push(
      ['findings.high', input.findings.high],
      ['findings.critical', input.findings.critical],
    );
  }
  if (input.tests !== null) {
    counts.push(
      ['tests.total', input.tests.total],
      ['tests.failed', input.tests.failed],
      ['tests.unexcusedFlaky', input.tests.unexcusedFlaky],
    );
  }
  if (input.evalRegressions !== null) counts.push(['evalRegressions', input.evalRegressions]);
  if (input.tampering !== null) counts.push(['tampering.findings', input.tampering.findings]);
  for (const [name, value] of counts) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative integer: ${String(value)}`);
    }
  }
  const coverage = input.diffCoverage;
  if (coverage !== null && (!Number.isFinite(coverage) || coverage < 0 || coverage > 100)) {
    throw new RangeError(`diffCoverage must be a percentage: ${String(coverage)}`);
  }
  for (const kind of policy.require ?? []) {
    if (!CHANGE_RISK_EVIDENCE.includes(kind)) {
      throw new RangeError(`unknown required evidence: ${String(kind)}`);
    }
  }
}

type Draft = Omit<ChangeRiskFactor, 'kind' | 'evidence'> & { from?: ChangeRiskEvidence };

function authorship(input: ChangeRiskInput): Draft[] {
  const who = input.agent === null ? '' : ` (${input.agent})`;
  if (input.attribution === 'agent-authored') {
    return [
      {
        id: 'ai-authorship',
        points: POINTS.agentAuthored,
        detail: `Written by an agent${who}.`,
        from: 'attribution',
      },
    ];
  }
  if (input.attribution === 'ai-assisted') {
    return [
      {
        id: 'ai-authorship',
        points: POINTS.aiAssisted,
        detail: `Written with AI assistance${who}.`,
        from: 'attribution',
      },
    ];
  }
  return [];
}

function review(input: ChangeRiskInput): Draft[] {
  if (input.humanApprovals > 0) return [];
  const ai = input.attribution === 'agent-authored' || input.attribution === 'ai-assisted';
  return [
    {
      id: 'no-human-approval',
      points: ai ? POINTS.noApprovalAi : POINTS.noApprovalOther,
      detail: ai ? 'AI-written and no person has approved it.' : 'No person has approved it.',
    },
  ];
}

function size(input: ChangeRiskInput): Draft[] {
  const lines = input.additions + input.deletions;
  const drafts: Draft[] = [];
  const band =
    lines >= POINTS.sizeVeryLarge.lines
      ? POINTS.sizeVeryLarge.points
      : lines >= POINTS.sizeLarge.lines
        ? POINTS.sizeLarge.points
        : 0;
  if (band > 0)
    drafts.push({ id: 'size', points: band, detail: `${plural(lines, 'line', 'lines')} changed.` });
  if (!input.testsTouched && lines >= POINTS.noTestsTouched.minLines) {
    drafts.push({
      id: 'no-tests-touched',
      points: POINTS.noTestsTouched.points,
      detail: 'No test file among the changes.',
    });
  }
  return drafts;
}

function coverage(input: ChangeRiskInput): Draft[] {
  const value = input.diffCoverage;
  if (value === null) return [];
  const points =
    value < POINTS.coverageLow.below
      ? POINTS.coverageLow.points
      : value < POINTS.coverageMid.below
        ? POINTS.coverageMid.points
        : 0;
  if (points === 0) return [];
  const shown = Math.round(value * 10) / 10;
  return [
    {
      id: 'diff-coverage',
      points,
      detail: `${String(shown)}% of the changed lines are covered.`,
      from: 'diff-coverage',
    },
  ];
}

function findings(input: ChangeRiskInput): Draft[] {
  const found = input.findings;
  if (found === null || found.high + found.critical === 0) return [];
  const parts = [
    ...(found.critical > 0
      ? [plural(found.critical, 'new critical finding', 'new critical findings')]
      : []),
    ...(found.high > 0 ? [plural(found.high, 'new high finding', 'new high findings')] : []),
  ];
  return [
    {
      id: 'new-findings',
      points: (found.critical > 0 ? POINTS.newCritical : 0) + (found.high > 0 ? POINTS.newHigh : 0),
      detail: `Adds ${parts.join(' and ')}.`,
      from: 'findings',
    },
  ];
}

function tests(input: ChangeRiskInput): Draft[] {
  const run = input.tests;
  if (run === null || run.total === 0) return [];
  const drafts: Draft[] = [];
  if (run.failed > 0) {
    drafts.push({
      id: 'failed-tests',
      points: POINTS.failedTests,
      detail: `${plural(run.failed, 'test fails', 'tests fail')} on this commit and quarantine does not excuse ${run.failed === 1 ? 'it' : 'them'}.`,
      from: 'tests',
    });
  }
  if (run.unexcusedFlaky > 0) {
    drafts.push({
      id: 'unexcused-flaky',
      points: POINTS.unexcusedFlaky,
      detail: `${plural(run.unexcusedFlaky, 'test', 'tests')} passed only on retry and ${run.unexcusedFlaky === 1 ? 'is' : 'are'} not quarantined.`,
      from: 'tests',
    });
  }
  return drafts;
}

function evals(input: ChangeRiskInput): Draft[] {
  const regressions = input.evalRegressions;
  if (regressions === null || regressions === 0) return [];
  return [
    {
      id: 'eval-regression',
      points: POINTS.evalRegression,
      detail: `${plural(regressions, 'eval suite regressed', 'eval suites regressed')}.`,
      from: 'evals',
    },
  ];
}

function blast(input: ChangeRiskInput): Draft[] {
  const radius = input.blastRadius;
  if (radius === null || radius.sensitiveAreas.length === 0) return [];
  const count = radius.sensitiveAreas.length;
  const more = radius.truncated ? ' (changed files were truncated, so there may be more)' : '';
  return [
    {
      id: 'blast-radius',
      points: Math.min(POINTS.sensitiveAreaCap, count * POINTS.perSensitiveArea),
      detail: `Touches ${plural(count, 'sensitive area', 'sensitive areas')}: ${radius.sensitiveAreas.join(', ')}${more}.`,
    },
  ];
}

function tampering(input: ChangeRiskInput): Draft[] {
  const found = input.tampering;
  if (found === null || found.findings === 0) return [];
  const kinds = [...new Set(found.kinds)].map((kind) => TAMPER_LABEL[kind]);
  const verb = found.findings === 1 ? 'change weakens' : 'changes weaken';
  return [
    {
      id: 'test-tampering',
      points: POINTS.testTampering,
      detail: `${String(found.findings)} ${verb} the tests${kinds.length === 0 ? '' : `: ${kinds.join(', ')}`}.`,
      from: 'tampering',
    },
  ];
}

function phases(input: ChangeRiskInput): Draft[] {
  const skipped = input.skippedPhases;
  if (skipped.length === 0) return [];
  return [
    {
      id: 'skipped-phases',
      points: Math.min(POINTS.skippedPhaseCap, skipped.length * POINTS.perSkippedPhase),
      detail: `Skipped ${skipped.length === 1 ? 'phase' : 'phases'}: ${skipped.join(', ')}.`,
    },
  ];
}

/** What was not there, each with the step that would supply it. */
function absent(input: ChangeRiskInput, required: ReadonlySet<ChangeRiskEvidence>) {
  const gaps: Array<{ id: ChangeRiskEvidence; detail: string }> = [];
  if (input.attribution === 'unknown') {
    gaps.push({
      id: 'attribution',
      detail:
        'Nobody could tell who wrote it: attribution is unknown, not human. Turn on delivery sync.',
    });
  }
  if (input.tests === null) {
    gaps.push({
      id: 'tests',
      detail: 'No test results for this commit: run `lupin test` or upload a report.',
    });
  } else if (input.tests.total === 0) {
    gaps.push({ id: 'tests', detail: 'The run on this commit reported no tests.' });
  }
  if (input.diffCoverage === null) {
    gaps.push({
      id: 'diff-coverage',
      detail: 'Diff coverage was not measured: upload coverage and the diff for this commit.',
    });
  }
  if (input.findings === null) {
    gaps.push({ id: 'findings', detail: 'No security scan was read for this commit.' });
  }
  if (input.tampering === null) {
    gaps.push({
      id: 'tampering',
      detail: 'Test changes were not checked: run `lupin diff-guard` in CI.',
    });
  }
  // Most projects run no evals, so their absence is only news when a policy requires them.
  if (input.evalRegressions === null && required.has('evals')) {
    gaps.push({ id: 'evals', detail: 'No eval results were read for this commit.' });
  }
  return gaps;
}

function levelOf(score: number): ChangeRiskLevel {
  if (score >= LEVEL_BANDS.critical) return 'critical';
  if (score >= LEVEL_BANDS.high) return 'high';
  if (score >= LEVEL_BANDS.medium) return 'medium';
  return 'low';
}

const higher = (a: ChangeRiskLevel, b: ChangeRiskLevel) =>
  changeRiskRank(a) >= changeRiskRank(b) ? a : b;

/**
 * The floors no sum of points may undercut: a new critical finding is at least `high`, and an
 * AI change that weakens its own tests is `critical` — the exact thing this product exists to
 * catch.
 */
function floorOf(input: ChangeRiskInput): ChangeRiskLevel {
  const ai = input.attribution === 'agent-authored' || input.attribution === 'ai-assisted';
  if (ai && input.tampering !== null && input.tampering.findings > 0) return 'critical';
  if (input.findings !== null && input.findings.critical > 0) return 'high';
  return 'low';
}

export function assessChangeRisk(
  input: ChangeRiskInput,
  policy: ChangeRiskPolicy = {},
): ChangeRisk {
  validate(input, policy);
  const required = new Set(policy.require ?? DEFAULT_REQUIRED_EVIDENCE);
  const evidenceOf = (from: ChangeRiskEvidence | undefined) =>
    from === undefined ? null : (input.evidence?.[from] ?? null);
  const risks: ChangeRiskFactor[] = [
    ...authorship(input),
    ...review(input),
    ...size(input),
    ...coverage(input),
    ...findings(input),
    ...tests(input),
    ...evals(input),
    ...blast(input),
    ...tampering(input),
    ...phases(input),
  ]
    .sort((a, b) => b.points - a.points || FACTOR_ORDER.indexOf(a.id) - FACTOR_ORDER.indexOf(b.id))
    .map(({ from, ...draft }) => ({ ...draft, kind: 'risk' as const, evidence: evidenceOf(from) }));
  const gaps = absent(input, required);
  const missing = gaps.filter((gap) => required.has(gap.id)).map((gap) => gap.id);
  const score = risks.reduce((sum, factor) => sum + factor.points, 0);
  const measured = higher(levelOf(score), floorOf(input));
  // Required evidence missing: `unknown` at best, and a measured high or critical stands.
  const level =
    missing.length > 0 && changeRiskRank(measured) < changeRiskRank('high') ? 'unknown' : measured;
  return {
    level,
    score,
    version: CHANGE_RISK_VERSION,
    factors: [
      ...risks,
      ...gaps.map((gap) => ({
        id: gap.id,
        kind: 'missing' as const,
        points: 0,
        detail: gap.detail,
        evidence: null,
      })),
    ],
    missing,
  };
}

/** Whether a policy fails the gate at this level. Unset `blockAt` reports and never blocks. */
export function riskBlocks(level: ChangeRiskLevel, policy: ChangeRiskPolicy): boolean {
  const blockAt = policy.blockAt ?? null;
  if (blockAt === null) return false;
  if (level === 'unknown') return policy.blockOnUnknown === true;
  return changeRiskRank(level) >= changeRiskRank(blockAt);
}
