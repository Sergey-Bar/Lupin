import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * The CI build is done once per commit, not once per job (ledger MNT-202).
 *
 * `quality` runs `pnpm typecheck`, whose turbo tasks build every workspace dependency, and
 * `unit-and-coverage` then ran `pnpm test` and `pnpm build` from nothing and built it all
 * again. Both now share turbo's local cache through `actions/cache`, keyed on the commit.
 *
 * **Keyed on the commit and nothing else, with no `restore-keys`.** A key that fell back to an
 * earlier commit would let turbo replay that commit's cached `test` results for every package
 * whose inputs it judged unchanged, so a run could pass on tests it never ran. On one commit
 * the only turbo work restored is what `quality` did, which runs no tests.
 */
const root = path.resolve(import.meta.dirname, '..', '..');
const workflow = readFileSync(path.join(root, '.github/workflows/unified-ci.yml'), 'utf8');

/** @param {string} id @returns {string} the job's body */
function job(id) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.ok(start !== -1, `no ${id} job`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/u);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

/** @param {string} body @returns {string | null} the turbo cache step, or null */
function turboCacheStep(body) {
  const at = body.indexOf('path: .turbo/cache');
  if (at === -1) return null;
  const start = body.lastIndexOf('- name:', at);
  const end = body.indexOf('\n      - name:', at);
  return body.slice(start, end === -1 ? undefined : end);
}

test('the workflow is read, so the check can fail', () => {
  assert.match(job('quality'), /run: pnpm typecheck/u);
  assert.match(job('unit-and-coverage'), /run: pnpm test/u);
});

for (const id of ['quality', 'unit-and-coverage']) {
  test(`${id} shares turbo's cache, keyed on the commit alone`, () => {
    const body = job(id);
    const step = turboCacheStep(body);
    assert.ok(step !== null, `${id} has no turbo cache step`);
    assert.match(step, /uses: actions\/cache@[0-9a-f]{40}/u);
    assert.match(step, /key: turbo-\$\{\{ runner\.os \}\}-\$\{\{ github\.sha \}\}/u);
    assert.doesNotMatch(step, /restore-keys/u);
    // Before the first turbo task, or it restores nothing that task could use.
    assert.ok(body.indexOf(step) < body.search(/run: pnpm (typecheck|test)\n/u));
  });
}
