/**
 * scorecard.test.mjs — the rubric refuses pasted results, and every probe can fail.
 *
 * Each probe is exercised against a fixture tree in both directions, because a probe that
 * only ever returned `ok` would make the scorecard a list of compliments.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROBES,
  contextFor,
  evaluate,
  rubricProblems,
  scores,
  standardThresholds,
} from './scorecard.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {Record<string, string>} files */
function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'scorecard-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return {
    root,
    ctx: contextFor(root),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

const LEDGER = JSON.stringify({
  findings: [
    { id: 'OPEN-ROW', status: 'open' },
    { id: 'FIXED-ROW', status: 'fixed' },
  ],
});

/** @param {Record<string, unknown>} overrides */
const criterion = (overrides) => ({
  id: 'x.one',
  area: 'infra',
  statement: 'Something true.',
  check: { probe: 'exists', paths: ['present.txt'] },
  ...overrides,
});

test('a criterion whose evidence path is missing fails, and passes once it exists', () => {
  const f = fixture({ 'docs/quality/findings-ledger.json': LEDGER });
  try {
    const rubric = { criteria: [criterion({})] };
    assert.equal(evaluate(rubric, f.ctx)[0]?.verdict, 'fail');
    writeFileSync(path.join(f.root, 'present.txt'), 'here');
    assert.equal(evaluate(rubric, contextFor(f.root))[0]?.verdict, 'pass');
  } finally {
    f.done();
  }
});

test('a criterion that records a result instead of deriving it is refused', () => {
  const f = fixture({ 'docs/quality/findings-ledger.json': LEDGER });
  try {
    for (const key of ['status', 'score', 'observed']) {
      const problems = rubricProblems({ criteria: [criterion({ [key]: 'pass' })] }, f.ctx);
      assert.ok(
        problems.some((p) => p.includes(`'${key}'`)),
        `${key}: ${problems.join('|')}`,
      );
    }
    const nested = rubricProblems(
      { criteria: [criterion({ check: { probe: 'coverage-standard', value: 91 } })] },
      f.ctx,
    );
    assert.ok(nested.some((p) => p.includes('restates a number')));
    // Control arm: the same criterion without the pasted field is clean.
    assert.deepEqual(rubricProblems({ criteria: [criterion({})] }, f.ctx), []);
  } finally {
    f.done();
  }
});

test('blocked-external needs a reason and an open ledger row, and goes stale on a pass', () => {
  const f = fixture({ 'docs/quality/findings-ledger.json': LEDGER });
  try {
    const noReason = criterion({ blockedExternal: { reason: '', ledger: 'OPEN-ROW' } });
    assert.ok(rubricProblems({ criteria: [noReason] }, f.ctx).some((p) => p.includes('reason')));

    const closed = criterion({ blockedExternal: { reason: 'r', ledger: 'FIXED-ROW' } });
    assert.ok(rubricProblems({ criteria: [closed] }, f.ctx).some((p) => p.includes('closed')));

    const good = criterion({ blockedExternal: { reason: 'needs a run', ledger: 'OPEN-ROW' } });
    assert.deepEqual(rubricProblems({ criteria: [good] }, f.ctx), []);
    assert.equal(evaluate({ criteria: [good] }, f.ctx)[0]?.verdict, 'blocked-external');

    writeFileSync(path.join(f.root, 'present.txt'), 'here');
    const stale = evaluate({ criteria: [good] }, contextFor(f.root))[0];
    assert.equal(stale?.verdict, 'fail');
    assert.match(stale?.reason ?? '', /stale/);
  } finally {
    f.done();
  }
});

test('an empty rubric is a failure, not a pass', () => {
  const f = fixture({});
  try {
    assert.equal(rubricProblems({ criteria: [] }, f.ctx).length, 1);
  } finally {
    f.done();
  }
});

test('coverage-standard reads the thresholds from vitest.shared.ts and fails below them', () => {
  const f = fixture({
    '.config/vitest.shared.ts':
      'export const STANDARD_THRESHOLDS = {\n  statements: 90,\n  branches: 80,\n} as const;',
    'docs/quality/coverage-baseline.json': JSON.stringify({
      a: { statements: 95, branches: 85 },
      b: { statements: 89.6, branches: 85 },
      c: { status: 'not_configured' },
    }),
  });
  try {
    assert.deepEqual(standardThresholds(f.ctx), { statements: 90, branches: 80 });
    const result = PROBES['coverage-standard']?.(f.ctx, {});
    assert.equal(result?.ok, false);
    assert.match(result?.reason ?? '', /b statements 89\.6<90/);
    assert.doesNotMatch(result?.reason ?? '', /\ba statements/);
  } finally {
    f.done();
  }
});

test('mutation-covers fails on a missing package and on a score under the target', () => {
  const f = fixture({
    'docs/quality/mutation-baseline.json': JSON.stringify({
      target: 75,
      packages: { good: { score: 80 }, weak: { score: 60 } },
    }),
  });
  try {
    assert.equal(PROBES['mutation-covers']?.(f.ctx, { packages: ['good'] }).ok, true);
    assert.equal(PROBES['mutation-covers']?.(f.ctx, { packages: ['weak'] }).ok, false);
    assert.equal(PROBES['mutation-covers']?.(f.ctx, { packages: ['absent'] }).ok, false);
  } finally {
    f.done();
  }
});

test('complexity-clean fails on an offender and on a ceiling above the wanted one', () => {
  const write = (/** @type {unknown} */ doc) =>
    fixture({ 'docs/quality/complexity-baseline.json': JSON.stringify(doc) });
  const cases = [
    [{ ceiling: 10, offenders: [] }, true],
    [{ ceiling: 10, offenders: [{ file: 'a' }] }, false],
    [{ ceiling: 12, offenders: [] }, false],
  ];
  for (const [doc, ok] of cases) {
    const f = write(doc);
    try {
      assert.equal(
        PROBES['complexity-clean']?.(f.ctx, { ceiling: 10 }).ok,
        ok,
        JSON.stringify(doc),
      );
    } finally {
      f.done();
    }
  }
});

test('contains and lacks are each other’s control arm', () => {
  const f = fixture({ 'a.yml': 'services:\n  web:\n    image: x\n  edge:\n    healthcheck: y\n' });
  try {
    // The healthcheck belongs to edge, not web, so the section-scoped pattern must miss it.
    const scoped = '^  web:\\n(?:(?!^  [a-z])[\\s\\S])*?^    healthcheck:';
    assert.equal(PROBES.contains?.(f.ctx, { path: 'a.yml', pattern: scoped }).ok, false);
    assert.equal(PROBES.contains?.(f.ctx, { path: 'a.yml', pattern: 'edge' }).ok, true);
    assert.equal(PROBES.lacks?.(f.ctx, { path: 'a.yml', pattern: 'edge' }).ok, false);
    assert.equal(PROBES.lacks?.(f.ctx, { path: 'a.yml', pattern: 'zap' }).ok, true);
    assert.equal(PROBES.contains?.(f.ctx, { path: 'absent.yml', pattern: 'x' }).ok, false);
  } finally {
    f.done();
  }
});

test('ledger, register, render and tier probes each fail on the wrong state', () => {
  const f = fixture({
    'docs/quality/findings-ledger.json': LEDGER,
    'docs/migration/capability-register.md': [
      '| ID | Capability | Status |',
      '| --- | --- | --- |',
      '| tool.zap | ZAP | missing |',
      '| ops.metrics | Metrics | real |',
    ].join('\n'),
    'tests/performance/rendering-budget.json': JSON.stringify({
      recorded: true,
      routes: { '/dashboard': {} },
    }),
    'scripts/gate-tooling.json': JSON.stringify({ tiers: { scorecard: 'pr-reporting' } }),
  });
  try {
    assert.equal(PROBES['ledger-closed']?.(f.ctx, { ids: ['FIXED-ROW'] }).ok, true);
    assert.equal(PROBES['ledger-closed']?.(f.ctx, { ids: ['OPEN-ROW'] }).ok, false);
    assert.equal(PROBES['register-status']?.(f.ctx, { ids: ['ops.metrics'] }).ok, true);
    assert.equal(PROBES['register-status']?.(f.ctx, { ids: ['tool.zap'] }).ok, false);
    assert.equal(PROBES['register-none']?.(f.ctx, { want: 'mock' }).ok, true);
    assert.equal(PROBES['register-none']?.(f.ctx, { want: 'missing' }).ok, false);
    assert.equal(PROBES['render-route']?.(f.ctx, { routes: ['/dashboard'] }).ok, true);
    assert.equal(PROBES['render-route']?.(f.ctx, { routes: ['/dashboard/now'] }).ok, false);
    const tier = PROBES.tier;
    assert.equal(tier?.(f.ctx, { script: 'scorecard', tier: 'pr-reporting' }).ok, true);
    assert.equal(tier?.(f.ctx, { script: 'scorecard', tier: 'pr-blocking' }).ok, false);
  } finally {
    f.done();
  }
});

test('a blocked criterion leaves the denominator rather than counting as a pass', () => {
  const reports = /** @type {const} */ ([
    { id: 'a', area: 'infra', statement: '', verdict: 'pass', reason: '' },
    { id: 'b', area: 'infra', statement: '', verdict: 'fail', reason: '' },
    { id: 'c', area: 'infra', statement: '', verdict: 'blocked-external', reason: '' },
  ]);
  const infra = scores([...reports]).find((s) => s.area === 'infra');
  assert.deepEqual(infra, { area: 'infra', score: 5, passed: 1, counted: 2, blocked: 1 });
});

test('the committed rubric is well-formed against the committed tree', () => {
  const ctx = contextFor(repo);
  assert.deepEqual(rubricProblems(ctx.json('docs/quality/scorecard.json'), ctx), []);
});
