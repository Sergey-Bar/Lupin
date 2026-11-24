// The public `lupin check` GitHub Action: what a user's workflow relies on, held to the code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const action = readFileSync(path.join(ROOT, 'actions', 'check', 'action.yml'), 'utf8');
const cli = JSON.parse(readFileSync(path.join(ROOT, 'tools', 'lupin-cli', 'package.json'), 'utf8'));

test('the action runs the CLI release it defaults to, and that release is this CLI', () => {
  const version = /version:[\s\S]*?default: '([^']+)'/u.exec(action)?.[1];
  assert.equal(version, cli.version, 'the default version moves with the CLI');
  assert.match(
    action,
    /releases\/download\/v\$\{LUPIN_VERSION\}\/lupin-cli-\$\{LUPIN_VERSION\}\.tgz/u,
  );
  assert.match(action, /lupin check "\$\{flags\[@\]\}" -- "\$\{files\[@\]\}"/u);
});

test('the action refuses a version that could inject into the URL', () => {
  assert.match(action, /\*\[!0-9A-Za-z\.-\]\*\) echo "::error::version must be a release number/u);
});

test('no report found is a failure, never a pass', () => {
  assert.match(action, /No test report found[\s\S]*?exit 1/u);
});

test('every input reaches the shell through env, never interpolated into the script', () => {
  const runs = [...action.matchAll(/run: \|\n([\s\S]*?)(?=\n {4}- name:|\n*$)/gu)].map(
    (m) => m[1] ?? '',
  );
  for (const body of runs) assert.doesNotMatch(body, /\$\{\{\s*inputs\./u);
});

test('the comment is one, found by its marker and updated, and a refusal never fails the job', () => {
  assert.match(action, /<!-- lupin-check -->/u);
  assert.match(action, /-X PATCH/u);
  assert.match(action, /\|\| echo "::warning::Could not comment/u);
});
