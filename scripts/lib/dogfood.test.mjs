import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dogfoodProblems } from './dogfood.mjs';

const GRADED = { grade: { letter: 'B', score: 84 } };
const VERDICT = { verdict: 'caution' };

test('a loop that completed, with a red suite and a failed gate, is not a dogfood failure', () => {
  assert.deepEqual(
    dogfoodProblems({
      exits: { suite: 1, 'agent-config': 0, gate: 1 },
      health: GRADED,
      readiness: VERDICT,
    }),
    [],
  );
});

test('the harness refutes a wrong claim: a CLI that could not reach the install fails', () => {
  const problems = dogfoodProblems({
    exits: { suite: 3, gate: 4 },
    health: GRADED,
    readiness: VERDICT,
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0] ?? '', /suite exited 3/u);
});

test('an install with no grade or no verdict for the project fails', () => {
  assert.deepEqual(
    dogfoodProblems({ exits: { gate: 0 }, health: {}, readiness: { verdict: 'maybe' } }),
    [
      'the install returned no grade for the project',
      'the install returned no release verdict for the project',
    ],
  );
});

test('no step at all is not a pass', () => {
  assert.ok(
    dogfoodProblems({ exits: {}, health: GRADED, readiness: VERDICT }).includes('no CLI step ran'),
  );
});
