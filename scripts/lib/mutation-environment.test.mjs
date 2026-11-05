import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { strykerEnvironment } from './mutation-environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Stryker runs without a job-summary path, and keeps everything else', () => {
  const env = { GITHUB_STEP_SUMMARY: '/tmp/summary', GITHUB_ACTIONS: 'true', PATH: '/bin' };
  assert.deepEqual(strykerEnvironment(env), { GITHUB_ACTIONS: 'true', PATH: '/bin' });
  assert.equal(env.GITHUB_STEP_SUMMARY, '/tmp/summary', 'the caller environment is not changed');
});

test('pnpm mutation passes that environment to Stryker', () => {
  const source = readFileSync(path.join(root, 'scripts', 'mutation.mjs'), 'utf8');
  assert.match(source, /env:\s*strykerEnvironment\(process\.env\)/u);
});
