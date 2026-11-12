import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Dependabot does not skip the version the catalog installs (ledger MNT-195).
 *
 * `.github/dependabot.yml` told Dependabot to skip `typescript-eslint` 8.72.1 because it ran
 * lint out of memory, while `pnpm-workspace.yaml` pinned exactly 8.72.1: the lint heap had
 * been raised and the pin moved, and the ignore and its comment were left describing a
 * decision that had been reversed. Skipping the installed version does nothing, and it says
 * the opposite of what the tree does.
 */
const root = path.resolve(import.meta.dirname, '..', '..');

/** @returns {Map<string, string>} name to the exact version the catalog pins */
function exactCatalogPins() {
  const yaml = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const catalog = yaml.slice(yaml.indexOf('\ncatalog:'));
  /** @type {Map<string, string>} */
  const pins = new Map();
  for (const match of catalog.matchAll(/^ {2}'?([@\w./-]+)'?: '?(\d+\.\d+\.\d+)'?\s*$/gmu)) {
    pins.set(match[1] ?? '', match[2] ?? '');
  }
  return pins;
}

/** @returns {Array<{ name: string, versions: string[] }>} */
function ignoredVersions() {
  const yaml = readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8');
  return [...yaml.matchAll(/- dependency-name: '([^']+)'\n\s+versions: \[([^\]]*)\]/gu)].map(
    (match) => ({
      name: match[1] ?? '',
      versions: (match[2] ?? '').split(',').map((v) => v.trim().replace(/^'|'$/gu, '')),
    }),
  );
}

test('the catalog and the ignore list are both read, so the check can fail', () => {
  assert.ok(exactCatalogPins().size >= 3, 'could not read any exact catalog pin');
  assert.ok(exactCatalogPins().has('uqr'), 'could not read the uqr pin the catalog carries');
});

test('dependabot is not told to skip the version the catalog installs', () => {
  const pins = exactCatalogPins();
  const contradictions = ignoredVersions()
    .filter(({ name, versions }) => versions.includes(pins.get(name) ?? ''))
    .map(({ name }) => `${name}@${pins.get(name) ?? ''}`);
  assert.deepEqual(
    contradictions,
    [],
    `ignored and installed at once: ${contradictions.join(', ')}`,
  );
});
