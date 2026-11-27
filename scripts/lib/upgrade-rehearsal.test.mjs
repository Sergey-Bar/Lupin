import assert from 'node:assert/strict';
import { test } from 'node:test';
import { upgradeProblems } from './upgrade-rehearsal.mjs';

const BEFORE = { version: '4.1.0', envDigest: 'e1', projects: ['shop'], findings: 2, runs: 3 };
const AFTER = { ...BEFORE, version: '5.0.0', findings: 2, runs: 3 };

test('an update that kept everything, and a rollback to the old release, has no problems', () => {
  assert.deepEqual(
    upgradeProblems({ before: BEFORE, after: AFTER, rolledBack: BEFORE, candidate: '5.0.0' }),
    [],
  );
});

test('the harness refutes a wrong claim: an update that lost a project fails', () => {
  const problems = upgradeProblems({
    before: BEFORE,
    after: { ...AFTER, projects: [] },
    candidate: '5.0.0',
  });
  assert.deepEqual(problems, ['project shop is gone after the update']);
});

test('a changed .env, lost findings or runs, or the wrong version each fail', () => {
  const problems = upgradeProblems({
    before: BEFORE,
    after: { ...AFTER, version: '4.1.0', envDigest: 'e2', findings: 1, runs: 0 },
    candidate: '5.0.0',
  });
  assert.equal(problems.length, 4);
});

test('a rollback that did not return to the old release, or lost a project, fails', () => {
  const problems = upgradeProblems({
    before: BEFORE,
    after: AFTER,
    rolledBack: { ...BEFORE, version: '5.0.0', projects: [] },
    candidate: '5.0.0',
  });
  assert.deepEqual(problems, [
    'the rollback reports 5.0.0, not 4.1.0',
    'project shop is gone after the rollback',
  ]);
});
