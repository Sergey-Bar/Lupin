import assert from 'node:assert/strict';
import test from 'node:test';
import { baseBaseline, loweredFloors } from './coverage-floor-ratchet.mjs';

const BASELINE = {
  'packages/shared-contracts': { statements: 99, branches: 97, functions: 97, lines: 99 },
  'packages/ui': { statements: 59, branches: 74, functions: 62, lines: 59 },
  'tests/contract': { status: 'not_configured', reason: 'a test-only package' },
};

/** @param {Record<string, unknown>} overrides */
function after(overrides = {}) {
  return { ...BASELINE, ...overrides };
}

test('an unchanged baseline lowers nothing', () => {
  assert.deepEqual(loweredFloors(BASELINE, after()), []);
});

test('a lowered floor is a finding, and names both numbers', () => {
  // The whole reason this module exists. `coverage-ratchet.mjs` alone reported
  // `passed` for this exact edit.
  const findings = loweredFloors(
    BASELINE,
    after({
      'packages/shared-contracts': { ...BASELINE['packages/shared-contracts'], statements: 1 },
    }),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0], /statements floor lowered from 99 to 1/);
});

test('a raised floor is progress, not a finding', () => {
  assert.deepEqual(
    loweredFloors(
      BASELINE,
      after({ 'packages/ui': { ...BASELINE['packages/ui'], statements: 65 } }),
    ),
    [],
  );
});

test('removing a package is a lowering, not a deletion', () => {
  const findings = loweredFloors(BASELINE, {
    'packages/ui': BASELINE['packages/ui'],
    'tests/contract': BASELINE['tests/contract'],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /packages\/shared-contracts: removed from coverage-baseline\.json/);
});

test('replacing a measured floor with not_configured is a lowering with another spelling', () => {
  const findings = loweredFloors(BASELINE, {
    ...after(),
    'packages/ui': { status: 'not_configured', reason: 'temporarily paused' },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /replaced with \{"status":"not_configured"\}/);
});

test('a not_configured package that was already not_configured is not a finding', () => {
  assert.deepEqual(
    loweredFloors(BASELINE, {
      ...after(),
      'tests/contract': { status: 'not_configured', reason: 'a different but honest reason' },
    }),
    [],
  );
});

test('a package that becomes not_configured and then configured again is compared from the base', () => {
  // Only the *base* state decides which comparison applies. A row that was measured
  // at the base and is measured now with a higher floor is progress.
  assert.deepEqual(
    loweredFloors(
      { 'packages/ui': { ...BASELINE['packages/ui'] } },
      { 'packages/ui': { ...BASELINE['packages/ui'], branches: 80 } },
    ),
    [],
  );
});

test('a floor that stops being a number is a finding', () => {
  const findings = loweredFloors(BASELINE, {
    ...after(),
    'packages/ui': { ...BASELINE['packages/ui'], branches: '74' },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /branches floor is no longer a number/);
});

test('a metric that was unmeasured at the base is reported rather than accepted', () => {
  // Adding a floor is good. Adding one that no base floor existed for is not
  // comparable, and reporting it is the difference between a visible change and a
  // silent one.
  const findings = loweredFloors(
    { 'packages/ui': { statements: 59 } },
    { 'packages/ui': { statements: 59, branches: 74 } },
  );
  assert.equal(findings.length, 1);
  assert.match(
    findings[0],
    /branches floor is new but the metric it guards was previously unmeasured/,
  );
});

test('a package absent from the base is not a finding', () => {
  // A brand-new package has no base floor, so there is nothing it could have
  // lowered. Failing on this would make adding a package impossible.
  assert.deepEqual(loweredFloors({}, after()), []);
});

test('no base at all lowers nothing, and says so rather than passing quietly', () => {
  assert.deepEqual(loweredFloors(null, after()), []);
  const result = baseBaseline({ ref: null, read: () => null });
  assert.equal(result.baseline, null);
  assert.match(result.reason, /no base ref was supplied/);
});

test('an unreadable base is reported, not treated as an empty base', () => {
  const result = baseBaseline({ ref: 'nope', read: () => null });
  assert.equal(result.baseline, null);
  assert.match(result.reason, /produced nothing/);
});

test('a base that is not valid JSON is reported with the parse error', () => {
  const result = baseBaseline({ ref: 'v1', read: () => '{ not json' });
  assert.equal(result.baseline, null);
  assert.match(result.reason, /not valid JSON/);
});

test('a readable base is parsed and named', () => {
  const result = baseBaseline({
    ref: 'abc123',
    read: () => JSON.stringify({ 'packages/ui': { statements: 59 } }),
  });
  assert.deepEqual(result.baseline, { 'packages/ui': { statements: 59 } });
  assert.match(result.reason, /compared against abc123/);
});

// A package can be renamed. The ratchet reads the baseline by key, so a rename looks exactly
// like deleting a floor and adding a new one, and a gate that cannot tell the two apart would
// either block every rename or be told to ignore removals. Neither is acceptable, so a rename
// is accepted only when it is recorded, and only if it keeps every metric of the old floor.

test('a recorded rename carries the floor across, and lowers nothing', () => {
  const before = { 'tools/old-cli': { statements: 96, branches: 92, functions: 98, lines: 96 } };
  const after = { 'tools/new-cli': { statements: 96, branches: 92, functions: 98, lines: 96 } };
  assert.deepEqual(loweredFloors(before, after, { 'tools/old-cli': 'tools/new-cli' }), []);
});

test('a rename that raises a floor is progress', () => {
  const before = { 'tools/old-cli': { statements: 96, branches: 92, functions: 98, lines: 96 } };
  const after = { 'tools/new-cli': { statements: 97, branches: 93, functions: 99, lines: 97 } };
  assert.deepEqual(loweredFloors(before, after, { 'tools/old-cli': 'tools/new-cli' }), []);
});

test('a rename cannot be used to lower a floor', () => {
  // The whole risk of accepting renames: move the package, drop the number in the same edit.
  const before = { 'tools/old-cli': { statements: 96, branches: 92, functions: 98, lines: 96 } };
  const after = { 'tools/new-cli': { statements: 50, branches: 92, functions: 98, lines: 96 } };
  const findings = loweredFloors(before, after, { 'tools/old-cli': 'tools/new-cli' });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /statements floor lowered from 96 to 50/);
  assert.match(findings[0], /tools\/new-cli/);
});

test('an unrecorded rename is still a removal', () => {
  const before = { 'tools/old-cli': { statements: 96, branches: 92, functions: 98, lines: 96 } };
  const after = { 'tools/new-cli': { statements: 96, branches: 92, functions: 98, lines: 96 } };
  const findings = loweredFloors(before, after);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /tools\/old-cli: removed from coverage-baseline\.json/);
});

test('a recorded rename whose new key is missing is a removal, not a pass', () => {
  const before = { 'tools/old-cli': { statements: 96, branches: 92, functions: 98, lines: 96 } };
  const findings = loweredFloors(before, {}, { 'tools/old-cli': 'tools/new-cli' });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /removed from coverage-baseline\.json/);
});

test('a rename does not excuse a measured floor becoming not_configured', () => {
  const before = { 'tools/old-cli': { statements: 96, branches: 92, functions: 98, lines: 96 } };
  const after = { 'tools/new-cli': { status: 'not_configured', reason: 'gave up' } };
  const findings = loweredFloors(before, after, { 'tools/old-cli': 'tools/new-cli' });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /not_configured/);
});

test('the rename map is only read for names that disappeared from the baseline', () => {
  // A stale rename entry must not mask a lowering on a package that still exists under its
  // old name: the old key is present, so it is compared as itself.
  const before = { 'tools/old-cli': { statements: 96, branches: 92, functions: 98, lines: 96 } };
  const after = { 'tools/old-cli': { statements: 10, branches: 92, functions: 98, lines: 96 } };
  const findings = loweredFloors(before, after, { 'tools/old-cli': 'tools/new-cli' });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /statements floor lowered from 96 to 10/);
});
