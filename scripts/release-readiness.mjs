/**
 * `pnpm release:readiness` — prints every gap between the tree and the release
 * defined in `docs/quality/release-journeys.json`, and exits 1 while any remain.
 *
 * Tier `pr-reporting` until the release is ready; it becomes `release` in the commit
 * that tags the candidate. The logic is `auditReadiness` in `lib/release-readiness.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readLedger, repoRoot } from './lib/findings-ledger.mjs';
import { auditReadiness, parseCapabilityStatuses } from './lib/release-readiness.mjs';

const root = repoRoot();
const journeys = JSON.parse(
  readFileSync(path.join(root, 'docs/quality/release-journeys.json'), 'utf8'),
);
const ledger = /** @type {Record<string, unknown>} */ (
  readLedger('docs/quality/findings-ledger.json')
);
const ledgerRows = Array.isArray(ledger['findings'])
  ? /** @type {Array<{ id: string, status: string, band: string }>} */ (ledger['findings'])
  : [];
const capabilities = parseCapabilityStatuses(
  readFileSync(path.join(root, 'docs/migration/capability-register.md'), 'utf8'),
);

const problems = auditReadiness({ journeys, ledgerRows, capabilities, root });
const release = typeof journeys.release === 'string' ? journeys.release : '(unnamed)';

const lines =
  problems.length === 0
    ? [`Release ${release} is ready: every journey and connector is proven.`]
    : [
        `Release ${release} is not ready (${problems.length} gap(s)):`,
        ...problems.map((p) => `- ${p}`),
      ];
(problems.length === 0 ? console.log : console.error)(lines.join('\n'));

const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
if (summaryPath) {
  writeFileSync(summaryPath, `### Release readiness\n\n${lines.join('\n')}\n\n`, { flag: 'a' });
}
process.exit(problems.length === 0 ? 0 : 1);
