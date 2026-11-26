/**
 * The 10/10 scorecard: one rubric per area, every verdict derived from the tree.
 *
 * `docs/quality/scorecard.json` holds criteria, never results. Each criterion names a
 * **probe** (a fixed, small vocabulary below) and the probe reads an authority that already
 * exists: the coverage, mutation and complexity baselines, the findings ledger, the
 * capability register, the rendering budget and the gate tiers. The scorecard never stores
 * a number it could read, because a second copy of a number is a second authority, and a
 * second authority is the one that goes stale (`.kilo/skills/no-second-authority`).
 *
 * That is also why `status` is not a field: it is computed on every run. The only state a
 * criterion may carry is `blockedExternal`, for a criterion the code alone cannot satisfy
 * (a measurement on the reference install). It is honoured only while the probe fails and
 * the ledger row it cites is still open, so a block cannot outlive its reason.
 *
 * Dependency-free on purpose, like `findings:check`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseRegister } from './capability-evidence.mjs';

export const AREAS = /** @type {const} */ ([
  'infra',
  'integrations',
  'backend',
  'frontend',
  'ux',
  'setup',
]);

/** Keys a criterion may carry. Anything else is refused, which is what stops a pasted result. */
const CRITERION_KEYS = new Set(['id', 'area', 'statement', 'check', 'blockedExternal']);

/**
 * Keys that would record an observation rather than state a requirement. A criterion that
 * carries one is restating a number some other file owns.
 */
const OBSERVATION_KEYS = new Set([
  'observed',
  'actual',
  'value',
  'score',
  'count',
  'status',
  'result',
  'passed',
]);

/** Ledger statuses that close a row. */
const CLOSED = new Set(['fixed', 'false-positive']);

/**
 * @typedef {{ id: string, area: string, statement: string, check: Record<string, unknown>,
 *   blockedExternal?: { reason: string, ledger: string } }} Criterion
 * @typedef {{ ok: boolean, reason: string }} ProbeResult
 * @typedef {'pass' | 'fail' | 'blocked-external'} Verdict
 * @typedef {{ id: string, area: string, statement: string, verdict: Verdict, reason: string }} Report
 * @typedef {{ root: string, read: (relative: string) => string | undefined,
 *   json: (relative: string) => unknown }} Context
 */

/** @param {string} root @returns {Context} */
export function contextFor(root) {
  /** @type {Map<string, string | undefined>} */
  const cache = new Map();
  const read = (/** @type {string} */ relative) => {
    if (!cache.has(relative)) {
      const full = path.join(root, relative);
      cache.set(relative, existsSync(full) ? readFileSync(full, 'utf8') : undefined);
    }
    return cache.get(relative);
  };
  return {
    root,
    read,
    json: (relative) => {
      const text = read(relative);
      return text === undefined ? undefined : JSON.parse(text);
    },
  };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
const record = (value) =>
  value !== null && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};

/** @param {unknown} value @returns {string[]} */
const strings = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

/** @param {Context} ctx */
function ledgerRows(ctx) {
  const findings = record(ctx.json('docs/quality/findings-ledger.json')).findings;
  return Array.isArray(findings) ? findings.map(record) : [];
}

/** @param {Context} ctx */
function registerRows(ctx) {
  return parseRegister(ctx.read('docs/migration/capability-register.md') ?? '');
}

/**
 * `STANDARD_THRESHOLDS` read out of `.config/vitest.shared.ts`, so the standard has one
 * spelling and this is not it.
 *
 * @param {Context} ctx
 * @returns {Record<string, number> | undefined}
 */
export function standardThresholds(ctx) {
  const text = ctx.read('.config/vitest.shared.ts') ?? '';
  const start = text.indexOf('STANDARD_THRESHOLDS');
  const open = start === -1 ? -1 : text.indexOf('{', start);
  const close = open === -1 ? -1 : text.indexOf('}', open);
  if (close === -1) return undefined;
  const block = text.slice(open + 1, close);
  /** @type {Record<string, number>} */
  const out = {};
  for (const entry of block.split(',')) {
    const [name, raw] = entry.split(':').map((part) => part.trim());
    const value = Number(raw);
    if (name && /^\w+$/u.test(name) && raw !== undefined && Number.isFinite(value)) {
      out[name] = value;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** @type {Record<string, (ctx: Context, check: Record<string, unknown>) => ProbeResult>} */
export const PROBES = {
  exists(ctx, check) {
    const missing = strings(check.paths).filter((p) => !existsSync(path.join(ctx.root, p)));
    return missing.length === 0
      ? { ok: true, reason: 'every path exists' }
      : { ok: false, reason: `missing: ${missing.join(', ')}` };
  },

  contains(ctx, check) {
    const file = String(check.path ?? '');
    const text = ctx.read(file);
    if (text === undefined) return { ok: false, reason: `${file} does not exist` };
    const pattern = new RegExp(String(check.pattern ?? ''), 'mu');
    return pattern.test(text)
      ? { ok: true, reason: `${file} matches /${pattern.source}/` }
      : { ok: false, reason: `${file} does not match /${pattern.source}/` };
  },

  lacks(ctx, check) {
    const file = String(check.path ?? '');
    const text = ctx.read(file);
    if (text === undefined) return { ok: false, reason: `${file} does not exist` };
    const pattern = new RegExp(String(check.pattern ?? ''), 'mu');
    const hit = pattern.exec(text);
    return hit === null
      ? { ok: true, reason: `${file} has no /${pattern.source}/` }
      : { ok: false, reason: `${file} still matches: ${hit[0].slice(0, 80)}` };
  },

  'coverage-standard'(ctx) {
    const standard = standardThresholds(ctx);
    if (standard === undefined) return { ok: false, reason: 'STANDARD_THRESHOLDS not found' };
    const baseline = record(ctx.json('docs/quality/coverage-baseline.json'));
    const below = [];
    for (const [pkg, floors] of Object.entries(baseline)) {
      const row = record(floors);
      if (typeof row.statements !== 'number') continue; // `not_configured` packages
      for (const [metric, floor] of Object.entries(standard)) {
        const have = row[metric];
        if (typeof have === 'number' && have < floor)
          below.push(`${pkg} ${metric} ${have}<${floor}`);
      }
    }
    return below.length === 0
      ? { ok: true, reason: 'every measured package meets STANDARD_THRESHOLDS' }
      : { ok: false, reason: `below the standard: ${below.join('; ')}` };
  },

  'mutation-covers'(ctx, check) {
    const baseline = record(ctx.json('docs/quality/mutation-baseline.json'));
    const target = typeof baseline.target === 'number' ? baseline.target : 100;
    const packages = record(baseline.packages);
    const problems = [];
    for (const pkg of strings(check.packages)) {
      const score = record(packages[pkg]).score;
      if (typeof score !== 'number') problems.push(`${pkg} has no mutation baseline`);
      else if (score < target) problems.push(`${pkg} ${score}<${target}`);
    }
    return problems.length === 0
      ? { ok: true, reason: `each package is at or above the mutation target` }
      : { ok: false, reason: problems.join('; ') };
  },

  'complexity-clean'(ctx, check) {
    const baseline = record(ctx.json('docs/quality/complexity-baseline.json'));
    const offenders = Array.isArray(baseline.offenders) ? baseline.offenders.length : -1;
    const ceiling = typeof baseline.ceiling === 'number' ? baseline.ceiling : Infinity;
    const wanted = typeof check.ceiling === 'number' ? check.ceiling : ceiling;
    if (offenders !== 0) return { ok: false, reason: `${offenders} recorded offender(s)` };
    if (ceiling > wanted) return { ok: false, reason: `ceiling ${ceiling} is above ${wanted}` };
    return { ok: true, reason: `no offenders at ceiling ${ceiling}` };
  },

  'ledger-closed'(ctx, check) {
    const rows = ledgerRows(ctx);
    const problems = [];
    for (const id of strings(check.ids)) {
      const row = rows.find((r) => r.id === id);
      if (row === undefined) problems.push(`${id} is not in the ledger`);
      else if (!CLOSED.has(String(row.status))) problems.push(`${id} is ${String(row.status)}`);
    }
    return problems.length === 0
      ? { ok: true, reason: 'every named row is closed' }
      : { ok: false, reason: problems.join('; ') };
  },

  'register-status'(ctx, check) {
    const rows = registerRows(ctx);
    const want = String(check.want ?? 'real');
    const problems = [];
    for (const id of strings(check.ids)) {
      const row = rows.find((r) => r.id === id);
      if (row === undefined) problems.push(`${id} is not in the register`);
      else if (row.status !== want) problems.push(`${id} is ${row.status}`);
    }
    return problems.length === 0
      ? { ok: true, reason: `every named row is ${want}` }
      : { ok: false, reason: problems.join('; ') };
  },

  'register-none'(ctx, check) {
    const status = String(check.want ?? '');
    const hits = registerRows(ctx)
      .filter((r) => r.status === status)
      .map((r) => r.id);
    return hits.length === 0
      ? { ok: true, reason: `no register row is ${status}` }
      : { ok: false, reason: `${status}: ${hits.join(', ')}` };
  },

  'render-route'(ctx, check) {
    const budget = record(ctx.json('tests/performance/rendering-budget.json'));
    const routes = record(budget.routes);
    const missing = strings(check.routes).filter((r) => !(r in routes));
    if (budget.recorded !== true) return { ok: false, reason: 'the budget is not recorded' };
    return missing.length === 0
      ? { ok: true, reason: 'every route is in the recorded budget' }
      : { ok: false, reason: `not measured: ${missing.join(', ')}` };
  },

  tier(ctx, check) {
    const tiers = record(record(ctx.json('scripts/gate-tooling.json')).tiers);
    const script = String(check.script ?? '');
    const want = String(check.tier ?? '');
    return tiers[script] === want
      ? { ok: true, reason: `${script} is ${want}` }
      : { ok: false, reason: `${script} is ${String(tiers[script] ?? 'untiered')}, not ${want}` };
  },
};

/**
 * Structural problems with the rubric itself. Any one of them fails the run, because a
 * scorecard that can hold a pasted result can be made to say 10/10 by editing a file.
 *
 * @param {unknown} document
 * @param {Context} ctx
 * @returns {string[]}
 */
export function rubricProblems(document, ctx) {
  const criteria = record(document).criteria;
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return ['the scorecard has no criteria: a rubric that measures nothing is not a pass'];
  }
  const problems = [];
  const seen = new Set();
  const ledger = ledgerRows(ctx);
  for (const raw of criteria) {
    const c = record(raw);
    const id = String(c.id ?? '(no id)');
    if (seen.has(id)) problems.push(`${id}: duplicate id`);
    seen.add(id);
    for (const key of Object.keys(c)) {
      if (OBSERVATION_KEYS.has(key)) {
        problems.push(`${id}: '${key}' records a result; the probe derives it`);
      } else if (!CRITERION_KEYS.has(key)) problems.push(`${id}: unknown key '${key}'`);
    }
    if (!AREAS.includes(/** @type {never} */ (c.area))) problems.push(`${id}: unknown area`);
    if (typeof c.statement !== 'string' || c.statement.trim() === '') {
      problems.push(`${id}: no statement`);
    }
    const check = record(c.check);
    if (!(String(check.probe) in PROBES))
      problems.push(`${id}: unknown probe '${String(check.probe)}'`);
    for (const key of Object.keys(check)) {
      if (OBSERVATION_KEYS.has(key)) problems.push(`${id}: check.${key} restates a number`);
    }
    if (c.blockedExternal !== undefined) {
      const block = record(c.blockedExternal);
      if (typeof block.reason !== 'string' || block.reason.trim() === '') {
        problems.push(`${id}: blockedExternal needs a reason`);
      }
      const row = ledger.find((r) => r.id === block.ledger);
      if (row === undefined) problems.push(`${id}: blockedExternal cites no ledger row`);
      else if (CLOSED.has(String(row.status))) {
        problems.push(`${id}: blockedExternal cites ${String(block.ledger)}, which is closed`);
      }
    }
  }
  return problems;
}

/**
 * @param {unknown} document
 * @param {Context} ctx
 * @returns {Report[]}
 */
export function evaluate(document, ctx) {
  const criteria = /** @type {Criterion[]} */ (record(document).criteria ?? []);
  return criteria.map((c) => {
    const probe = PROBES[String(c.check.probe)];
    const result =
      probe === undefined ? { ok: false, reason: 'unknown probe' } : probe(ctx, c.check);
    /** @type {Verdict} */
    let verdict = result.ok ? 'pass' : 'fail';
    let reason = result.reason;
    if (c.blockedExternal !== undefined) {
      if (result.ok) {
        reason = `passes, so its blockedExternal is stale and must be removed (${reason})`;
        verdict = 'fail';
      } else {
        verdict = 'blocked-external';
        reason = `${c.blockedExternal.reason} [${c.blockedExternal.ledger}] — ${reason}`;
      }
    }
    return { id: c.id, area: c.area, statement: c.statement, verdict, reason };
  });
}

/**
 * Score per area, out of ten. A blocked criterion is out of the denominator: it is neither
 * a pass nor a fault of the code, and the printout names it.
 *
 * @param {Report[]} reports
 */
export function scores(reports) {
  return AREAS.map((area) => {
    const mine = reports.filter((r) => r.area === area);
    const counted = mine.filter((r) => r.verdict !== 'blocked-external');
    const passed = counted.filter((r) => r.verdict === 'pass').length;
    const score = counted.length === 0 ? 0 : Math.round((passed / counted.length) * 100) / 10;
    return {
      area,
      score,
      passed,
      counted: counted.length,
      blocked: mine.length - counted.length,
    };
  });
}
