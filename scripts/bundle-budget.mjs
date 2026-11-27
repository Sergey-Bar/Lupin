/**
 * `pnpm bundle:budget`: fails when the built web bundle is over `docs/quality/bundle-budget.json`.
 * Needs `apps/web/dist` (the render-budget job builds it). `--write` records the ceilings from
 * this build, by hand and deliberately, never in CI.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ceilingFor, measure, overBudget } from './lib/bundle-budget.mjs';

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'docs', 'quality', 'bundle-budget.json');
const measured = measure(path.join(root, 'apps', 'web', 'dist'));

if (process.argv.includes('--write')) {
  const budget = {
    $comment:
      'Gzipped size of the web bundle (scripts and stylesheets). Ceilings are the reading plus 15%; raise them with `node scripts/bundle-budget.mjs --write`, deliberately.',
    measuredOn: new Date().toISOString().slice(0, 10),
    observed: {
      totalKb: measured.totalKb,
      largestKb: measured.largestKb,
      largest: measured.largest,
    },
    totalKb: ceilingFor(measured.totalKb),
    largestKb: ceilingFor(measured.largestKb),
  };
  writeFileSync(target, `${JSON.stringify(budget, null, 2)}\n`);
  console.log(
    `bundle budget recorded: ${String(budget.totalKb)} KB total, ${String(budget.largestKb)} KB per script`,
  );
  process.exit(0);
}

const budget = JSON.parse(readFileSync(target, 'utf8'));
const problems = overBudget(measured, budget);
console.log(
  `bundle: ${String(measured.totalKb)} KB gzipped over ${String(measured.files)} files (budget ${String(budget.totalKb)}); largest ${measured.largest} ${String(measured.largestKb)} KB (budget ${String(budget.largestKb)})`,
);
if (problems.length > 0) {
  for (const problem of problems) console.error(`bundle budget: ${problem}`);
  process.exit(1);
}
