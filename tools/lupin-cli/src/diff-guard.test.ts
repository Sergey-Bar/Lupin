import { describe, expect, it } from 'vitest';
import {
  DIFF_GUARD_VERSION,
  MAX_FINDINGS,
  SNAPSHOT_BULK_FILES,
  analyzeDiff,
  isTestPath,
  type GuardFinding,
} from './diff-guard.js';

/** One modified file's diff, with its hunks written as they appear in `git diff -U0`. */
function modified(path: string, ...hunks: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks,
  ].join('\n');
}

function deleted(path: string, lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    'deleted file mode 100644',
    'index 1111111..0000000',
    `--- a/${path}`,
    '+++ /dev/null',
    `@@ -1,${String(lines.length)} +0,0 @@`,
    ...lines.map((line) => `-${line}`),
  ].join('\n');
}

function renamed(from: string, to: string): string {
  return [
    `diff --git a/${from} b/${to}`,
    'similarity index 100%',
    `rename from ${from}`,
    `rename to ${to}`,
  ].join('\n');
}

const kinds = (findings: readonly GuardFinding[]) => findings.map((finding) => finding.kind);

describe('isTestPath', () => {
  it.each([
    'src/cart.test.ts',
    'src/cart.spec.tsx',
    'apps/web/src/__tests__/x.js',
    'tests/e2e/checkout.spec.ts',
    'test/unit/a.mjs',
    'pkg/cart_test.go',
    'app/test_cart.py',
    'app/tests/conftest.py',
    'src/test/java/com/acme/CartTest.java',
    'Cart.Tests/CartTests.cs',
    'e2e/login.cy.ts',
  ])('reads %s as a test', (path) => {
    expect(isTestPath(path)).toBe(true);
  });

  it.each(['src/cart.ts', 'src/testing-library.ts', 'docs/tests.md', 'src/contest.ts'])(
    'reads %s as not a test',
    (path) => {
      expect(isTestPath(path)).toBe(false);
    },
  );
});

describe('analyzeDiff: what weakens a test', () => {
  it('finds a deleted test file, and a test renamed out of the test tree', () => {
    const report = analyzeDiff(
      [
        deleted('src/cart.test.ts', ["it('adds', () => {", '  expect(add(1)).toBe(1);', '});']),
        renamed('src/price.test.ts', 'src/price-helpers.ts'),
        renamed('src/a.test.ts', 'src/b.test.ts'),
        deleted('src/legacy.ts', ['export const x = 1;']),
      ].join('\n'),
    );
    expect(report.findings).toEqual([
      { kind: 'test-deleted', path: 'src/cart.test.ts', line: null, side: 'base' },
      { kind: 'test-deleted', path: 'src/price.test.ts', line: null, side: 'base' },
    ]);
    expect(report.version).toBe(DIFF_GUARD_VERSION);
  });

  it.each([
    ["  it.skip('adds', () => {"],
    ["  test.only('adds', () => {"],
    ["  describe.skip('cart', () => {"],
    ["  xit('adds', () => {"],
    ["  fdescribe('cart', () => {"],
    ["  test.fixme('adds', async () => {"],
    ['  @Disabled("flaky")'],
    ['@pytest.mark.skip(reason="later")'],
    ['    t.Skip("later")'],
  ])('finds an added skip or focus: %s', (line) => {
    const report = analyzeDiff(modified('src/cart.test.ts', '@@ -10,0 +11 @@', `+${line}`));
    expect(report.findings).toEqual([
      { kind: 'skip-added', path: 'src/cart.test.ts', line: 11, side: 'head' },
    ]);
  });

  it('does not read a skip inside a string, a comment, or a non-test file', () => {
    const report = analyzeDiff(
      [
        modified(
          'src/cart.test.ts',
          '@@ -10,0 +11,3 @@',
          `+  const hint = "use it.skip( sparingly";`,
          "+  // it.skip('was flaky', () => {",
          '+  /* xit( */ expect(1).toBe(1);',
        ),
        modified('src/docs.ts', '@@ -1,0 +2 @@', "+export const x = 'it.skip(';"),
        modified('src/runner.ts', '@@ -1,0 +2 @@', '+  it.skip(name, fn);'),
      ].join('\n'),
    );
    expect(report.findings).toEqual([]);
  });

  it('does not count a skip that only moved within the file', () => {
    const report = analyzeDiff(
      modified(
        'src/cart.test.ts',
        '@@ -3 +2,0 @@',
        "-  it.skip('adds', () => {",
        '@@ -20,0 +20 @@',
        "+  it.skip('adds', () => {",
      ),
    );
    expect(report.findings).toEqual([]);
  });

  it('finds assertions removed, net of the ones added, on the base side', () => {
    const report = analyzeDiff(
      modified(
        'src/cart.test.ts',
        '@@ -5,3 +5 @@',
        '-  expect(total).toBe(10);',
        '-  expect(items).toHaveLength(2);',
        '-  assert.equal(tax, 1);',
        '+  expect(total).toBe(10);',
      ),
    );
    expect(report.findings).toEqual([
      { kind: 'assertion-removed', path: 'src/cart.test.ts', line: 6, side: 'base' },
      { kind: 'assertion-removed', path: 'src/cart.test.ts', line: 7, side: 'base' },
    ]);
  });

  it('finds an assertion loosened to toBeDefined or toBeTruthy in the same hunk', () => {
    const report = analyzeDiff(
      modified(
        'src/cart.test.ts',
        '@@ -8,2 +8,2 @@',
        '-  expect(total).toBe(10);',
        "-  expect(user.name).toEqual('Ada');",
        '+  expect(total).toBeDefined();',
        '+  expect(user.name).toBeTruthy();',
      ),
    );
    expect(kinds(report.findings)).toEqual(['assertion-loosened', 'assertion-loosened']);
    expect(report.findings.map((finding) => finding.line)).toEqual([8, 9]);
  });

  it('does not call a new loose assertion loosening when nothing strict was removed', () => {
    const report = analyzeDiff(
      modified('src/cart.test.ts', '@@ -8,0 +9 @@', '+  expect(created).toBeDefined();'),
    );
    expect(report.findings).toEqual([]);
  });

  it.each([
    ['  } catch {}'],
    ['  } catch (error) { }'],
    ['  await save().catch(() => {});'],
    ['    except Exception: pass'],
  ])('finds an empty catch added to a test: %s', (line) => {
    const report = analyzeDiff(modified('src/cart.test.ts', '@@ -1,0 +2 @@', `+${line}`));
    expect(kinds(report.findings)).toEqual(['empty-catch']);
  });

  it('finds a bulk snapshot update, and not a single updated snapshot', () => {
    const snapshot = (index: number) =>
      modified(
        `src/__snapshots__/c${String(index)}.test.ts.snap`,
        '@@ -1 +1 @@',
        '-exports[`a 1`] = `"x"`;',
        '+exports[`a 1`] = `"y"`;',
      );
    const one = analyzeDiff(snapshot(0));
    expect(one.findings).toEqual([]);
    const bulk = analyzeDiff(
      Array.from({ length: SNAPSHOT_BULK_FILES }, (_, index) => snapshot(index)).join('\n'),
    );
    expect(kinds(bulk.findings)).toEqual(
      Array.from({ length: SNAPSHOT_BULK_FILES }, () => 'snapshot-bulk-update'),
    );
  });

  it('finds a lowered coverage threshold, and not a raised one', () => {
    const lowered = analyzeDiff(
      modified(
        'vitest.config.ts',
        '@@ -7,2 +7,2 @@',
        '-        statements: 90,',
        '-        branches: 80,',
        '+        statements: 70,',
        '+        branches: 85,',
      ),
    );
    expect(lowered.findings).toEqual([
      { kind: 'threshold-lowered', path: 'vitest.config.ts', line: 7, side: 'head' },
    ]);
    const baseline = analyzeDiff(
      modified(
        'docs/quality/coverage-baseline.json',
        '@@ -3 +3 @@',
        '-    "lines": 97,',
        '+    "lines": 96.5,',
      ),
    );
    expect(kinds(baseline.findings)).toEqual(['threshold-lowered']);
    const python = analyzeDiff(
      modified('setup.cfg', '@@ -2 +2 @@', '-fail_under = 85', '+fail_under = 60'),
    );
    expect(kinds(python.findings)).toEqual(['threshold-lowered']);
  });

  it.each([
    ['      continue-on-error: true'],
    ['        run: pnpm test || true'],
    ['  allow_failure: true'],
    ['        run: pytest || exit 0'],
    ['    if: false'],
  ])('finds a CI step made unable to fail: %s', (line) => {
    const report = analyzeDiff(modified('.github/workflows/ci.yml', '@@ -20,0 +21 @@', `+${line}`));
    expect(kinds(report.findings)).toEqual(['ci-made-non-failing']);
  });

  it('finds a removed test step in CI, and not a renamed one', () => {
    const removed = analyzeDiff(
      modified('.github/workflows/ci.yml', '@@ -30 +29,0 @@', '-      - run: pnpm test'),
    );
    expect(removed.findings).toEqual([
      { kind: 'ci-made-non-failing', path: '.github/workflows/ci.yml', line: 30, side: 'base' },
    ]);
    const moved = analyzeDiff(
      modified(
        '.github/workflows/ci.yml',
        '@@ -30 +30 @@',
        '-      - run: pnpm test',
        '+      - run: pnpm test --run',
      ),
    );
    expect(moved.findings).toEqual([]);
  });

  it('does not read CI patterns outside CI files', () => {
    const report = analyzeDiff(modified('scripts/build.sh', '@@ -1,0 +2 @@', '+make docs || true'));
    expect(report.findings).toEqual([]);
  });

  it('finds added or raised retries, and not lowered ones', () => {
    const raised = analyzeDiff(
      modified('playwright.config.ts', '@@ -4 +4 @@', '-  retries: 0,', '+  retries: 2,'),
    );
    expect(raised.findings).toEqual([
      { kind: 'retry-added', path: 'playwright.config.ts', line: 4, side: 'head' },
    ]);
    const lowered = analyzeDiff(
      modified('playwright.config.ts', '@@ -4 +4 @@', '-  retries: 2,', '+  retries: 1,'),
    );
    expect(lowered.findings).toEqual([]);
    const marker = analyzeDiff(
      modified('app/test_cart.py', '@@ -1,0 +2 @@', '+@pytest.mark.flaky(reruns=3)'),
    );
    expect(kinds(marker.findings)).toEqual(['retry-added']);
    const jest = analyzeDiff(modified('src/cart.test.ts', '@@ -1,0 +2 @@', '+jest.retryTimes(3);'));
    expect(kinds(jest.findings)).toEqual(['retry-added']);
  });
});

describe('analyzeDiff: what it sends', () => {
  it('counts every kind, and says how many files it read', () => {
    const report = analyzeDiff(
      [
        modified(
          'src/cart.test.ts',
          '@@ -1,0 +2,2 @@',
          "+it.skip('a', () => {",
          "+xit('b', () => {",
        ),
        modified('src/cart.ts', '@@ -1 +1 @@', '-a', '+b'),
      ].join('\n'),
    );
    expect(report.counts).toEqual({ 'skip-added': 2 });
    expect(report.filesChecked).toBe(2);
    expect(report.truncated).toBe(false);
  });

  it('keeps at most the finding limit, counts all of them, and says it was truncated', () => {
    const lines = Array.from(
      { length: MAX_FINDINGS + 10 },
      (_, index) => `+xit('t${String(index)}', () => {`,
    );
    const report = analyzeDiff(
      modified('src/many.test.ts', `@@ -0,0 +1,${String(lines.length)} @@`, ...lines),
    );
    expect(report.findings).toHaveLength(MAX_FINDINGS);
    expect(report.counts['skip-added']).toBe(MAX_FINDINGS + 10);
    expect(report.truncated).toBe(true);
  });

  it('never carries a line of source: only kinds, paths and line numbers', () => {
    const secretish = 'expect(computeTotal(SECRET_MARKER_42)).toBe(10);';
    const report = analyzeDiff(
      [
        modified('src/cart.test.ts', '@@ -5 +4,0 @@', `-  ${secretish}`),
        modified('src/cart.test.ts', '@@ -9,0 +9 @@', "+  it.skip('SECRET_MARKER_43', () => {"),
      ].join('\n'),
    );
    expect(report.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(/SECRET_MARKER|computeTotal|toBe\(/u);
    for (const finding of report.findings) {
      expect(Object.keys(finding).sort()).toEqual(['kind', 'line', 'path', 'side']);
    }
  });

  it('reads an empty diff as nothing found, with nothing checked', () => {
    expect(analyzeDiff('')).toMatchObject({ findings: [], counts: {}, filesChecked: 0 });
  });

  it('numbers lines through context, as a diff with context lines writes them', () => {
    const report = analyzeDiff(
      modified(
        'src/cart.test.ts',
        '@@ -1,4 +1,5 @@',
        " describe('cart', () => {",
        "   it('adds', () => {",
        "+  it.skip('removes', () => {",
        '     expect(1).toBe(1);',
        '   });',
      ),
    );
    expect(report.findings).toEqual([
      { kind: 'skip-added', path: 'src/cart.test.ts', line: 3, side: 'head' },
    ]);
  });

  it('reports each added retry once, in line order', () => {
    const report = analyzeDiff(
      modified(
        'playwright.config.ts',
        '@@ -2,0 +3 @@',
        '+  retries: 2,',
        '@@ -8,0 +10 @@',
        "+  use: { trace: 'on' }, reruns: 1,",
      ),
    );
    expect(report.findings.map((finding) => [finding.kind, finding.line])).toEqual([
      ['retry-added', 3],
      ['retry-added', 10],
    ]);
  });

  it('reads CRLF line endings the same as LF', () => {
    const report = analyzeDiff(
      modified('src/cart.test.ts', '@@ -1,0 +2 @@', "+it.skip('a', () => {").replaceAll(
        '\n',
        '\r\n',
      ),
    );
    expect(kinds(report.findings)).toEqual(['skip-added']);
  });
});
