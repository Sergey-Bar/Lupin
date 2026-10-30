import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * The product has one name, and it is this one.
 *
 * A rename that only edits the places a searcher happens to look is a rename that
 * half happened. This repository carried the product's former name in **eight files**
 * across five categories — a README sentence, a superseded draft PRD with thirty
 * references, a migration manifest's forensic records, an architecture decision record,
 * a ledger row, a plan document, and the drift gate that exempted the PRD — and only
 * two of the eight were about the product's identity. The rest were different kinds
 * of record that happened to contain the string, which is what makes a rename hard:
 * each needs a different decision, and the decision has to be written down rather than
 * guessed at in a find-and-replace.
 *
 * The distinctions that mattered, recorded because they are the reason this is a test
 * and not a `grep` in a shell history:
 *
 *   - **The README sentence was also wrong about the product.** It described the
 *     repository as "a planned QA automation control plane" with a product name in
 *     front of it, which is not what `2.0.0` shipped. Removing the name without fixing
 *     the sentence would have left a README that is half-right.
 *   - **The PRD claimed to be marked superseded and was not.** Its own header said
 *     `Status: Draft`, and `docs-drift.mjs` exempted it on the grounds that it was
 *     marked in its own text. One document asserting a status its header denies is
 *     worth more than an unexempted one, so the file was deleted rather than relabelled.
 *   - **The migration manifest's paths are labels; its git blob hashes are evidence.**
 *     Renaming a forensic record to satisfy a name check would have falsified it. The
 *     hashes are the part that lets a reviewer confirm nothing was lost in the
 *     migration, and they survive a rename.
 *
 * So the test asserts the absence of the name, and the ledger and the drift gate record
 * why each removal was a decision. A check that only greps would pass on a repository
 * that deleted a forensic record to make itself look clean.
 */

/** From the repository root, so a `path.join` rather than a `URL` — `URL` is a global
 *  ESLint does not declare for a plain `.mjs` in this repository, and a test that cannot
 *  lint is a test the gate eventually skips. */
/** @param {string} relative */
const fromRoot = (relative) =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', relative);

/**
 * Every retired name, as a pattern with the reason it is retired.
 *
 * The product has been renamed twice. Each pattern is one layer of the second rename
 * (to Lupin, 4.0.0), added in the commit that converted that layer, so a layer that has
 * been converted cannot quietly come back while the others are still in flight.
 *
 * Patterns are POSIX extended regular expressions as `git grep -E` reads them, matched
 * case-insensitively when `ignoreCase` is set. **Each is written so that it does not match
 * its own spelling in this file** — `automat[e]` matches the name, and the text
 * `automat[e]` does not — so the gate needs no exemption for the file that declares it.
 *
 * @type {ReadonlyArray<{ pattern: string, ignoreCase: boolean, reason: string }>}
 */
export const RETIRED_NAMES = [
  {
    pattern: 'q-?ace',
    ignoreCase: true,
    reason: 'the first product name; retired before 2.0.0',
  },
  {
    pattern: '--automat[e]-',
    ignoreCase: false,
    reason: 'the design-token namespace of the second name; every token is `--lupin-*` since 4.0.0',
  },
  {
    pattern: '@automat[e]',
    ignoreCase: true,
    reason: 'the package scope of the second name; every workspace package is `@lupin/*`',
  },
  {
    pattern: 'automat[e]-(cli|health|tui|local|lan-cert|tls)',
    ignoreCase: true,
    reason:
      'paths and binaries renamed to `lupin-*` (the CLI, the CI action, the TUI, the local tool, the edge scripts)',
  },
  {
    pattern: 'AUTOMAT[E]_',
    ignoreCase: false,
    reason:
      'the environment-variable prefix of the second name; every variable is `LUPIN_*` since 4.0.0',
  },
];

/**
 * Tracked files that may keep a retired name, each with the reason.
 *
 * Empty on purpose. A file goes here only when changing it would falsify a record or
 * break something outside this repository's control — never because the edit is tedious.
 *
 * @type {ReadonlyArray<{ path: string, reason: string }>}
 */
export const RETIRED_NAME_EXEMPTIONS = [];

/**
 * `git grep` over tracked files, as `path:line` hits. Untracked files are excluded on
 * purpose: this asserts what is committed, which is what a reader gets.
 *
 * @param {{ pattern: string, ignoreCase: boolean }} retired
 * @returns {string[]}
 */
function trackedHits(retired) {
  const exclusions = RETIRED_NAME_EXEMPTIONS.map((entry) => `:(exclude)${entry.path}`);
  const args = ['grep', '-n', '-E', ...(retired.ignoreCase ? ['-i'] : []), '-e', retired.pattern];
  let stdout = '';
  try {
    stdout = execFileSync('git', [...args, '--', '.', ...exclusions], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // git grep exits 1 when it matches nothing, which is the pass case here.
    const failure = /** @type {{ status?: number, stdout?: string }} */ (error);
    if (failure.status !== 1) {
      throw new Error(`git grep could not run: ${String(failure.stdout ?? '').slice(0, 300)}`, {
        cause: error,
      });
    }
  }
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(':').slice(0, 2).join(':'));
}

for (const retired of RETIRED_NAMES) {
  test(`the retired name /${retired.pattern}/ appears nowhere in the tree`, () => {
    const hits = trackedHits(retired);
    assert.deepEqual(
      hits,
      [],
      `/${retired.pattern}/ (${retired.reason}) is still present in:\n` +
        `${hits.slice(0, 200).join('\n')}${hits.length > 200 ? `\n…and ${String(hits.length - 200)} more` : ''}\n\n` +
        'If a hit is a record that must keep the name — a forensic manifest, a historical ' +
        'log — it needs a written reason in RETIRED_NAME_EXEMPTIONS, not a quiet re-add.',
    );
  });
}

test('every retired-name exemption names a tracked file and a reason', () => {
  for (const entry of RETIRED_NAME_EXEMPTIONS) {
    assert.ok(entry.reason.trim().length > 0, `${entry.path} is exempt with no reason`);
    const listed = execFileSync('git', ['ls-files', '--', entry.path], { encoding: 'utf8' });
    assert.ok(listed.trim().length > 0, `${entry.path} is exempt but is not a tracked file`);
  }
});

test('the drift gate no longer exempts a document that does not exist', () => {
  // `SUPERSEDED_DOCS` is a set of paths the gate does not check, so a deleted document
  // left in it is an exemption for nothing — the exact failure mode where a gate's
  // configuration drifts from the tree it governs.
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs-drift.mjs'),
    'utf8',
  );
  const block = /export const SUPERSEDED_DOCS = new Set\(\[([\s\S]*?)\]\)/.exec(source);
  assert.ok(block, 'SUPERSEDED_DOCS must still be declared as a Set literal this test can read');

  const paths = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(
    paths.length > 0,
    'SUPERSEDED_DOCS must not be empty — one document is still superseded',
  );

  for (const docPath of paths) {
    let exists = true;
    try {
      readFileSync(fromRoot(docPath));
    } catch {
      exists = false;
    }
    assert.ok(exists, `${docPath} is exempted from the drift gate but does not exist`);
  }
});

test('the README names the product it actually is', () => {
  // The sentence this test guards was wrong twice over: it carried the old name, and it
  // described the repository as "planned" after `2.0.0` shipped. A README can pass every
  // other gate in this repository while describing a product that does not exist.
  const readme = readFileSync(fromRoot('README.md'), 'utf8');
  assert.match(readme, /<h1>Lupin<\/h1>/, 'the README must open with the product name, Lupin');
  assert.match(
    readme,
    /A self-hosted home for test runs, evidence, and release decisions\./,
    'the README opening paragraph must describe the shipped product',
  );
  assert.doesNotMatch(
    readme,
    /planned QA automation control plane/i,
    'the README must not describe a shipped release as planned',
  );
});

test('the migration manifest keeps its blob hashes', () => {
  // The three residue paths were relabelled. Their `gitBlob` values are the evidence —
  // each resolves the original blob in git history — so a rename that dropped one would
  // silently destroy the only thing that made the record checkable.
  const manifest = JSON.parse(
    readFileSync(fromRoot('docs/migration/source-manifest.json'), 'utf8'),
  );
  const residue = manifest.sources?.[0]?.persistence?.trackedResidue;
  assert.ok(Array.isArray(residue) && residue.length > 0, 'trackedResidue must still be recorded');

  for (const entry of residue) {
    assert.match(
      entry.gitBlob ?? '',
      /^[0-9a-f]{40}$/,
      `${entry.path} lost its git blob hash; the rename may only have touched the label`,
    );
  }
});
