import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ceilingFor, measure, overBudget } from './bundle-budget.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');

test('measures scripts and stylesheets gzipped, and names the largest script', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-'));
  try {
    mkdirSync(path.join(dir, 'assets'));
    // Random bytes do not compress, so their gzipped size is about their size.
    writeFileSync(path.join(dir, 'assets', 'big.js'), randomBytes(40 * 1024));
    writeFileSync(path.join(dir, 'assets', 'small.js'), randomBytes(8 * 1024));
    writeFileSync(path.join(dir, 'assets', 'style.css'), randomBytes(4 * 1024));
    writeFileSync(path.join(dir, 'index.html'), randomBytes(100 * 1024));
    const measured = measure(dir);
    assert.equal(measured.files, 3);
    assert.equal(measured.largest, 'assets/big.js');
    assert.ok(measured.largestKb >= 40 && measured.largestKb <= 41, String(measured.largestKb));
    assert.ok(measured.totalKb >= 52 && measured.totalKb <= 53, String(measured.totalKb));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses to measure an unbuilt bundle rather than passing on nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-empty-'));
  try {
    assert.throws(() => measure(dir), /build the web app first/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the gate can fail: over either ceiling is a problem, at or under is none', () => {
  const budget = { totalKb: 100, largestKb: 40 };
  assert.deepEqual(overBudget({ totalKb: 100, largestKb: 40, largest: 'a.js' }, budget), []);
  assert.equal(overBudget({ totalKb: 101, largestKb: 40, largest: 'a.js' }, budget).length, 1);
  assert.match(
    overBudget({ totalKb: 90, largestKb: 41, largest: 'a.js' }, budget)[0] ?? '',
    /a\.js/u,
  );
  assert.equal(ceilingFor(100), 115);
});

test('the committed budget leaves headroom over its own reading', () => {
  const budget = JSON.parse(
    readFileSync(path.join(root, 'docs/quality/bundle-budget.json'), 'utf8'),
  );
  assert.ok(budget.totalKb >= budget.observed.totalKb);
  assert.ok(budget.largestKb >= budget.observed.largestKb);
  assert.equal(budget.totalKb, ceilingFor(budget.observed.totalKb));
});
