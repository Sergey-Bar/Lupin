import { describe, expect, it } from 'vitest';
import { parseReport } from './local-report.js';

const outcomes = (source: string, report: unknown) =>
  parseReport(source, JSON.stringify(report)).tests.map((test) => [
    test.key,
    test.outcome,
    test.message,
  ]);

describe('lupin check reads the JSON reports QA tools write', () => {
  it('reads Jest and Vitest --json', () => {
    expect(
      outcomes('jest.json', {
        numTotalTests: 3,
        testResults: [
          {
            name: '/repo/src/cart.test.ts',
            assertionResults: [
              { ancestorTitles: ['cart'], title: 'adds', status: 'passed', duration: 4 },
              {
                ancestorTitles: ['cart'],
                title: 'totals',
                status: 'failed',
                failureMessages: ['Error: expected 1 to be 2\n    at x (cart.ts:1)'],
              },
              { ancestorTitles: [], title: 'later', status: 'todo' },
            ],
          },
        ],
      }),
    ).toEqual([
      ['src/cart.test.ts › cart › adds', 'passed', null],
      ['src/cart.test.ts › cart › totals', 'failed', 'Error: expected 1 to be 2'],
      ['src/cart.test.ts › later', 'skipped', null],
    ]);
  });

  it('reads CTRF, with its flaky flag and retries', () => {
    expect(
      outcomes('ctrf.json', {
        results: {
          tool: { name: 'any' },
          tests: [
            {
              name: 'pays',
              status: 'passed',
              duration: 10,
              suite: 'checkout',
              filePath: 'pay.spec.ts',
            },
            { name: 'retries', status: 'passed', duration: 5, flaky: true },
            { name: 'breaks', status: 'failed', duration: 7, message: 'boom' },
            { name: 'waits', status: 'pending', duration: 0 },
          ],
        },
      }),
    ).toEqual([
      ['pay.spec.ts › checkout › pays', 'passed', null],
      ['retries', 'flaky', null],
      ['breaks', 'failed', 'boom'],
      ['waits', 'skipped', null],
    ]);
  });

  it('reads Mochawesome, nested suites included', () => {
    expect(
      outcomes('mochawesome.json', {
        stats: { tests: 2 },
        results: [
          {
            file: 'cypress/e2e/login.cy.js',
            tests: [],
            suites: [
              {
                title: 'login',
                tests: [
                  { title: 'signs in', state: 'passed', duration: 30 },
                  {
                    title: 'rejects',
                    state: 'failed',
                    duration: 9,
                    err: { message: 'AssertionError: nope' },
                  },
                  { title: 'skips', state: 'pending', pending: true },
                ],
                suites: [],
              },
            ],
          },
        ],
      }),
    ).toEqual([
      ['cypress/e2e/login.cy.js › login › signs in', 'passed', null],
      ['cypress/e2e/login.cy.js › login › rejects', 'failed', 'AssertionError: nope'],
      ['cypress/e2e/login.cy.js › login › skips', 'skipped', null],
    ]);
  });

  it('reads pytest-json-report, an error and an xfail included', () => {
    expect(
      outcomes('pytest.json', {
        tests: [
          { nodeid: 'tests/test_cart.py::test_adds', outcome: 'passed', call: { duration: 0.01 } },
          {
            nodeid: 'tests/test_cart.py::test_totals',
            outcome: 'failed',
            call: { duration: 0.2, crash: { message: 'assert 1 == 2' } },
          },
          {
            nodeid: 'tests/test_db.py::test_conn',
            outcome: 'error',
            setup: { longrepr: 'ConnectionError: refused' },
          },
          { nodeid: 'tests/test_cart.py::test_known', outcome: 'xfailed' },
        ],
      }),
    ).toEqual([
      ['tests/test_cart.py › test_adds', 'passed', null],
      ['tests/test_cart.py › test_totals', 'failed', 'assert 1 == 2'],
      ['tests/test_db.py › test_conn', 'failed', 'ConnectionError: refused'],
      ['tests/test_cart.py › test_known', 'skipped', null],
    ]);
  });

  it('falls back sensibly when a writer leaves fields out', () => {
    expect(
      outcomes('jest.json', {
        testResults: [
          { testFilePath: 'C:\\repo\\tests\\a.test.js', assertionResults: [{ status: 'failed' }] },
          7,
        ],
      }),
    ).toEqual([['tests/a.test.js › (unnamed)', 'failed', 'failed with no message']]);
    expect(outcomes('ctrf.json', { results: { tests: [{ status: 'other' }, null] } })).toEqual([
      ['(unnamed)', 'skipped', null],
      ['(unnamed)', 'skipped', null],
    ]);
    expect(
      outcomes('m.json', {
        stats: {},
        results: [{ tests: [{ state: 'failed' }], suites: [null] }],
      }),
    ).toEqual([['(unnamed)', 'failed', 'failed with no message']]);
    expect(
      outcomes('p.json', {
        tests: [
          { nodeid: 'test_x.py', outcome: 'failed', teardown: { longrepr: 'late' } },
          { nodeid: 'a.py::b::c', outcome: 'failed', call: { duration: 'x' } },
        ],
      }),
    ).toEqual([
      ['test_x.py', 'failed', 'late'],
      ['a.py › b::c', 'failed', 'failed with no message'],
    ]);
  });

  it('refuses a JSON document no reader knows, naming the formats it does', () => {
    expect(() => parseReport('bad.json', '{ not json')).toThrow(/bad\.json: not valid JSON/u);
    expect(() => parseReport('x.json', '{"tests":[{"name":"a"}]}')).toThrow(/not Playwright/u);
    expect(() => parseReport('x.json', '{"hello":1}')).toThrow(
      /x\.json: a JSON report, but not Playwright, Jest, Vitest, CTRF, Mochawesome or pytest-json-report/u,
    );
  });
});
