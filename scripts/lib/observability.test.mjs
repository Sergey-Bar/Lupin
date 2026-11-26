/**
 * observability.test.mjs — the alert rules and the dashboard name only series the API emits.
 *
 * A rule over a series nothing serves never fires, and it never fails either: Prometheus
 * evaluates it to an empty vector, which is indistinguishable from "all is well". So the
 * series named in `infra/observability/` are read and each must appear as a metric name in
 * the API's observability sources (plan 1795712849115 task 8).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (/** @type {string} */ relative) => readFileSync(path.join(root, relative), 'utf8');

/** Series names in a PromQL-bearing text: `lupin_*` and `process_*`. */
function seriesIn(/** @type {string} */ text) {
  return new Set(text.match(/\b(?:lupin|process)_[a-z_]+\b/gu) ?? []);
}

/** Metric names the API's observability sources emit. */
function emitted() {
  const directory = path.join(root, 'apps/api/src/observability');
  const names = new Set();
  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(path.join(directory, file), 'utf8');
    for (const match of source.matchAll(/name: '((?:lupin|process)_[a-z_]+)'/gu)) {
      names.add(match[1]);
    }
  }
  return names;
}

test('every series an alert rule names is one the API emits', () => {
  const known = emitted();
  const missing = [...seriesIn(read('infra/observability/alerts.yml'))].filter(
    (name) => !known.has(name),
  );
  assert.deepEqual(missing, []);
});

test('every series the dashboard draws is one the API emits', () => {
  const dashboard = JSON.parse(read('infra/observability/dashboard.json'));
  const expressions = dashboard.panels
    .flatMap((/** @type {{ targets?: { expr: string }[] }} */ panel) => panel.targets ?? [])
    .map((/** @type {{ expr: string }} */ target) => target.expr)
    .join('\n');
  const known = emitted();
  assert.deepEqual(
    [...seriesIn(expressions)].filter((name) => !known.has(name)),
    [],
  );
});

test('the check can fail: a renamed series is reported', () => {
  const known = emitted();
  assert.ok(known.has('lupin_runner_heartbeat_age_seconds'));
  assert.ok(!known.has('lupin_runner_heartbeat_seconds'));
  const missing = [...seriesIn('lupin_runner_heartbeat_seconds > 300')].filter(
    (name) => !known.has(name),
  );
  assert.deepEqual(missing, ['lupin_runner_heartbeat_seconds']);
});

test('every rule says what to do about it', () => {
  const rules = read('infra/observability/alerts.yml').split('- alert: ').slice(1);
  assert.ok(rules.length > 0, 'no rules were read');
  for (const rule of rules) {
    const name = rule.split('\n')[0];
    assert.match(rule, /\n\s+fix: \S/u, `${name} has no fix annotation`);
  }
});
