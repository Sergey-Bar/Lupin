import { describe, expect, it } from 'vitest';
import { IMPACT_VERSION, selectTests, testStem } from './impact.js';

const TRACKED = [
  'src/cart.ts',
  'src/cart.test.ts',
  'src/price.ts',
  'src/__tests__/price.ts',
  'legacy/cart.test.ts',
  'src/orders/index.ts',
  'e2e/checkout.spec.ts',
  'app/models.py',
  'tests/test_models.py',
  'pkg/server/handler.go',
  'pkg/server/handler_test.go',
  'README.md',
];

describe('testStem', () => {
  it('is the name a test is named after, in every convention', () => {
    expect(testStem('src/cart.test.ts')).toBe('cart');
    expect(testStem('src/cart.spec.tsx')).toBe('cart');
    expect(testStem('tests/test_models.py')).toBe('models');
    expect(testStem('pkg/handler_test.go')).toBe('handler');
    expect(testStem('src\\__tests__\\price.ts')).toBe('price');
  });

  it('reads a file at the repository root, and a name with no extension or a leading dot', () => {
    expect(testStem('cart.test.ts')).toBe('cart');
    expect(testStem('.env')).toBe('.env');
    expect(testStem('Makefile')).toBe('Makefile');
    expect(selectTests(['cart.ts'], ['cart.test.ts', 'src/cart.test.ts']).tests).toEqual([
      { path: 'cart.test.ts', reason: 'named', source: 'cart.ts' },
    ]);
  });
});

describe('selectTests', () => {
  it('runs a changed test, and the nearest test named after each changed source', () => {
    const report = selectTests(
      [
        'src/cart.ts',
        'src/price.ts',
        'e2e/checkout.spec.ts',
        'app/models.py',
        'pkg/server/handler.go',
      ],
      TRACKED,
    );
    expect(report).toMatchObject({ version: IMPACT_VERSION, runAll: null, changedFiles: 5 });
    expect(report.tests).toEqual([
      { path: 'e2e/checkout.spec.ts', reason: 'changed', source: null },
      { path: 'pkg/server/handler_test.go', reason: 'named', source: 'pkg/server/handler.go' },
      { path: 'src/__tests__/price.ts', reason: 'named', source: 'src/price.ts' },
      // The nearest only: legacy/cart.test.ts shares no directory with src/cart.ts.
      { path: 'src/cart.test.ts', reason: 'named', source: 'src/cart.ts' },
      { path: 'tests/test_models.py', reason: 'named', source: 'app/models.py' },
    ]);
    expect(report.untested).toEqual([]);
  });

  it('lists a changed source with no test named after it, and ignores what is not code', () => {
    const report = selectTests(['src/orders/index.ts', 'README.md'], TRACKED);
    expect(report.tests).toEqual([]);
    expect(report.untested).toEqual(['src/orders/index.ts']);
  });

  it('says to run everything when what every test depends on changed', () => {
    for (const path of [
      'package.json',
      'pnpm-lock.yaml',
      'apps/web/vitest.config.ts',
      'tsconfig.base.json',
      'go.mod',
    ]) {
      expect(selectTests([path, 'src/cart.ts'], TRACKED).runAll, path).toBe(
        `${path} changed, and every test depends on it`,
      );
    }
    expect(selectTests(['src/cart.ts'], TRACKED).runAll).toBeNull();
  });

  it('lists each test once, however many changed files point at it', () => {
    const report = selectTests(['src/cart.ts', 'src/cart.test.ts', './src/cart.ts'], TRACKED);
    expect(report.tests).toEqual([{ path: 'src/cart.test.ts', reason: 'changed', source: null }]);
  });
});
