import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './findings-ledger.mjs';
import { auditReadiness, parseCapabilityStatuses } from './release-readiness.mjs';

const ROOT = '/repo';
/** @param {string[]} present */
const existsOnly = (present) => (/** @type {string} */ file) =>
  present.some((spec) => path.join(ROOT, spec) === file);

const READY = {
  journeys: {
    release: '9.9.9',
    journeys: [{ id: 'j', specs: ['a.spec.ts'], capabilities: ['x.real'] }],
    connectors: [{ id: 'c', specs: ['a.spec.ts'], verification: 'fake-verified' }],
  },
  ledgerRows: [{ id: 'F-1', status: 'fixed', band: 'Blocker' }],
  capabilities: new Map([['x.real', 'real']]),
  root: ROOT,
  exists: existsOnly(['a.spec.ts']),
};

test('a fully proven release has no problems', () => {
  assert.deepEqual(auditReadiness(READY), []);
});

test('the harness refutes a wrong claim: a ready-looking release with a missing spec fails', () => {
  const problems = auditReadiness({ ...READY, exists: existsOnly([]) });
  assert.ok(problems.length > 0, 'a release whose specs do not exist must not be ready');
});

test('a missing spec path fails', () => {
  const problems = auditReadiness({
    ...READY,
    journeys: { ...READY.journeys, journeys: [{ id: 'j', specs: ['gone.spec.ts'] }] },
  });
  assert.deepEqual(problems, ['journey j: spec gone.spec.ts does not exist']);
});

test('a journey with no spec fails', () => {
  const problems = auditReadiness({
    ...READY,
    journeys: { ...READY.journeys, journeys: [{ id: 'j', specs: [] }] },
  });
  assert.deepEqual(problems, ['journey j: no spec proves it']);
});

test('an empty definition fails rather than passing on nothing', () => {
  const problems = auditReadiness({ ...READY, journeys: {} });
  assert.deepEqual(problems, [
    'release-journeys.json lists no journeys',
    'release-journeys.json lists no connectors',
  ]);
});

test('an empty ledger fails', () => {
  assert.deepEqual(auditReadiness({ ...READY, ledgerRows: [] }), ['findings ledger is empty']);
});

test('an open Blocker and a Critical debt fail; a Major debt does not', () => {
  const problems = auditReadiness({
    ...READY,
    ledgerRows: [
      { id: 'B-1', status: 'open', band: 'Blocker' },
      { id: 'C-1', status: 'debt', band: 'Critical' },
      { id: 'M-1', status: 'debt', band: 'Major' },
    ],
  });
  assert.deepEqual(problems, ['ledger B-1: Blocker is open', 'ledger C-1: Critical is debt']);
});

test('a connector below fake-verified, or with an unknown level, fails', () => {
  const problems = auditReadiness({
    ...READY,
    journeys: {
      ...READY.journeys,
      connectors: [
        { id: 'a', specs: ['a.spec.ts'], verification: 'none' },
        { id: 'b', specs: ['a.spec.ts'] },
        { id: 'c', specs: ['a.spec.ts'], verification: 'trust-me' },
        { id: 'd', specs: ['a.spec.ts'], verification: 'live-verified' },
      ],
    },
  });
  assert.deepEqual(problems, [
    'connector a: verification is none, needs fake-verified',
    'connector b: verification is none, needs fake-verified',
    'connector c: unknown verification level "trust-me"',
  ]);
});

test('a journey resting on a mock or unregistered capability fails', () => {
  const problems = auditReadiness({
    ...READY,
    journeys: {
      ...READY.journeys,
      journeys: [{ id: 'j', specs: ['a.spec.ts'], capabilities: ['x.real', 'y.mock', 'z.none'] }],
    },
    capabilities: new Map([
      ['x.real', 'real'],
      ['y.mock', 'mock'],
    ]),
  });
  assert.deepEqual(problems, [
    'journey j: capability y.mock is mock, not real',
    'journey j: capability z.none is not in the register',
  ]);
});

test('the register parser reads id and status from the table', () => {
  const statuses = parseCapabilityStatuses(
    '| Capability | What | Status |\n| --- | --- | --- |\n| tool.junit | JUnit | real |\n| automation.chat | Chat | mock |\n',
  );
  assert.deepEqual(
    [...statuses],
    [
      ['tool.junit', 'real'],
      ['automation.chat', 'mock'],
    ],
  );
});

test('the shipped definition names only registered capabilities', () => {
  const root = repoRoot();
  const doc = JSON.parse(
    readFileSync(path.join(root, 'docs/quality/release-journeys.json'), 'utf8'),
  );
  const statuses = parseCapabilityStatuses(
    readFileSync(path.join(root, 'docs/migration/capability-register.md'), 'utf8'),
  );
  const unknown = doc.journeys
    .flatMap((/** @type {{ capabilities?: string[] }} */ j) => j.capabilities ?? [])
    .filter((/** @type {string} */ id) => !statuses.has(id));
  assert.deepEqual(unknown, []);
});
