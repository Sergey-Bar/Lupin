/**
 * The web bundle's size budget (plan 1795712849115 task 17): what a browser downloads, gzipped,
 * measured from `apps/web/dist` and compared with `docs/quality/bundle-budget.json`.
 *
 * Two ceilings, because they fail differently: the **total** of every script and stylesheet is
 * what a cold visit costs, and the **largest** script is what blocks the first paint. A
 * ceiling is `ceilingFor(observed)`, the reading plus headroom, never the reading itself, so a
 * one-line change does not turn the gate red; and it only moves up by a deliberate `--write`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** @param {number} observedKb */
export function ceilingFor(observedKb) {
  return Math.ceil(observedKb * 1.15);
}

/**
 * Every script and stylesheet under `dir`, gzipped, in KB.
 *
 * @param {string} dir
 * @returns {{ totalKb: number, largestKb: number, largest: string, files: number }}
 */
export function measure(dir) {
  /** @type {string[]} */
  const assets = [];
  const walk = (/** @type {string} */ at) => {
    for (const name of readdirSync(at)) {
      const full = path.join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(?:js|mjs|css)$/u.test(name)) assets.push(full);
    }
  };
  walk(dir);
  if (assets.length === 0)
    throw new Error(`no scripts or stylesheets under ${dir}; build the web app first`);
  let total = 0;
  let largest = 0;
  let largestName = '';
  for (const file of assets) {
    const size = gzipSync(readFileSync(file)).length;
    total += size;
    if (/\.m?js$/u.test(file) && size > largest) {
      largest = size;
      largestName = path.relative(dir, file).replaceAll('\\', '/');
    }
  }
  return {
    totalKb: Math.round(total / 1024),
    largestKb: Math.round(largest / 1024),
    largest: largestName,
    files: assets.length,
  };
}

/**
 * The problems with a measurement against a budget; empty is a pass.
 *
 * @param {{ totalKb: number, largestKb: number, largest: string }} measured
 * @param {{ totalKb: number, largestKb: number }} budget
 * @returns {string[]}
 */
export function overBudget(measured, budget) {
  const problems = [];
  if (measured.totalKb > budget.totalKb) {
    problems.push(
      `the bundle is ${String(measured.totalKb)} KB gzipped, over its ${String(budget.totalKb)} KB budget`,
    );
  }
  if (measured.largestKb > budget.largestKb) {
    problems.push(
      `${measured.largest} is ${String(measured.largestKb)} KB gzipped, over the ${String(budget.largestKb)} KB budget for one script`,
    );
  }
  return problems;
}
