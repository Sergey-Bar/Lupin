/**
 * `pnpm scorecard` — the 10/10 rubric, scored per area from the tree.
 *
 * Reads `docs/quality/scorecard.json` (criteria only) and derives every verdict through
 * `scripts/lib/scorecard.mjs`. Exits non-zero on a malformed rubric always, and on a failing
 * criterion only with `--strict`: the tier is `pr-reporting` until the first all-pass run, and
 * graduating is one commit that adds `--strict` to the script and moves the tier.
 *
 * `--json` prints the structure instead of the table.
 */
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { contextFor, evaluate, rubricProblems, scores } from './lib/scorecard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = contextFor(root);
const rubric = ctx.json('docs/quality/scorecard.json');

const problems = rubricProblems(rubric, ctx);
if (problems.length > 0) {
  console.error('scorecard: the rubric itself is malformed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const reports = evaluate(rubric, ctx);
const perArea = scores(reports);
const failing = reports.filter((r) => r.verdict === 'fail');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scores: perArea, criteria: reports }, null, 2));
} else {
  console.log('Lupin scorecard — out of 10 per area, every verdict derived from the tree');
  console.log('');
  for (const s of perArea) {
    const blocked = s.blocked > 0 ? `, ${String(s.blocked)} blocked-external` : '';
    console.log(
      `  ${s.area.padEnd(13)} ${s.score.toFixed(1).padStart(4)}  (${String(s.passed)}/${String(s.counted)}${blocked})`,
    );
  }
  for (const verdict of /** @type {const} */ (['fail', 'blocked-external'])) {
    const rows = reports.filter((r) => r.verdict === verdict);
    if (rows.length === 0) continue;
    console.log('');
    console.log(verdict === 'fail' ? 'Failing:' : 'Blocked on a measurement outside the code:');
    for (const r of rows) {
      console.log(`  ${r.id}`);
      console.log(`      ${r.statement}`);
      console.log(`      ${r.reason}`);
    }
  }
  writeSummary();
}

if (process.argv.includes('--strict') && failing.length > 0) {
  console.error(`scorecard: ${String(failing.length)} criterion/criteria fail.`);
  process.exit(1);
}

function writeSummary() {
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  // No existence check first: checking then writing is a race, and the runner creates the file.
  if (!summaryPath) return;
  appendFileSync(
    summaryPath,
    [
      '### Scorecard',
      '',
      '| Area | Score | Passed | Blocked |',
      '| --- | --- | --- | --- |',
      ...perArea.map(
        (s) =>
          `| ${s.area} | ${s.score.toFixed(1)} | ${String(s.passed)}/${String(s.counted)} | ${String(s.blocked)} |`,
      ),
      '',
      ...failing.map((r) => `- **${r.id}**: ${r.reason}`),
      '',
    ].join('\n'),
    'utf8',
  );
}
