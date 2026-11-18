/**
 * `pnpm connectors:live` — the opt-in live connector probes (`lib/connectors-live.mjs`).
 * Needs `pnpm build` first: it imports each adapter's built `dist` by path, because the root
 * package depends on none of them.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitCodeFor, runProbes } from './lib/connectors-live.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/** @param {string} name */
const load = async (name) => {
  const file = path.join(ROOT, 'packages', 'connectors', name, 'dist', 'index.js');
  const module = /** @type {Record<string, unknown>} */ (await import(pathToFileURL(file).href));
  return /** @type {import('./lib/connectors-live.mjs').Adapter} */ (module[`${name}Adapter`]);
};

const adapters = Object.fromEntries(
  await Promise.all(
    ['github', 'jira', 'slack', 'telegram', 'whatsapp', 'signal'].map(async (name) => [
      name,
      await load(name),
    ]),
  ),
);
const results = await runProbes(adapters, process.env);
const lines = [
  '### Live connector probes',
  '',
  '| Connector | Result | Detail |',
  '| --- | --- | --- |',
];
for (const entry of results) lines.push(`| ${entry.id} | ${entry.result} | ${entry.detail} |`);
console.log(lines.join('\n'));
const summary = process.env['GITHUB_STEP_SUMMARY'];
if (summary) writeFileSync(summary, `${lines.join('\n')}\n\n`, { flag: 'a' });
process.exit(exitCodeFor(results));
