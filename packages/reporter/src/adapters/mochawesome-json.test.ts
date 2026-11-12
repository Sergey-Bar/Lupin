import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { mochawesomeJsonAdapter } from './mochawesome-json.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://mochawesome',
  sourceDigest: 'e'.repeat(64),
  producerVersion: '7.1.3',
  adapterVersion: '1.0.0',
  startedAt: '2026-10-01T00:00:00.000Z',
};

const test = (overrides: Record<string, unknown>) => ({
  title: 'untitled',
  fullTitle: 'untitled',
  timedOut: false,
  duration: 10,
  state: 'passed',
  speed: 'fast',
  pass: true,
  fail: false,
  pending: false,
  context: null,
  code: 'cy.visit("/")',
  err: {},
  uuid: 'u',
  parentUUID: 'p',
  isHook: false,
  skipped: false,
  ...overrides,
});

/** A merged Mochawesome report from a Cypress run. */
const report = {
  stats: { suites: 2, tests: 5, passes: 1, failures: 1, pending: 1, skipped: 1 },
  results: [
    {
      uuid: 'root',
      title: '',
      fullFile: '/home/ci/repo/cypress/e2e/checkout.cy.ts',
      file: 'cypress/e2e/checkout.cy.ts',
      tests: [],
      suites: [
        {
          uuid: 's1',
          title: 'Checkout',
          file: '',
          tests: [
            test({ title: 'pays' }),
            test({
              title: 'refunds',
              state: 'failed',
              pass: false,
              fail: true,
              err: { message: 'AssertionError: expected 500 to equal 200', estack: '...' },
              context: JSON.stringify({
                title: 'cypress-mochawesome-reporter-screenshots',
                value: 'cypress/screenshots/refunds (failed).png',
              }),
            }),
            test({ title: 'exports', state: 'pending', pass: false, pending: true }),
          ],
          suites: [
            {
              uuid: 's2',
              title: 'Card',
              tests: [
                test({ title: 'saves the card', state: null, pass: false, skipped: true }),
                test({ title: 'never ran', state: null, pass: false }),
              ],
              suites: [],
            },
          ],
        },
      ],
    },
  ],
  meta: { mocha: { version: '10.2.0' }, mochawesome: { version: '7.1.3' } },
};

const parse = (document: unknown) =>
  mochawesomeJsonAdapter.parse(new TextEncoder().encode(JSON.stringify(document)), context);

describe('mochawesomeJsonAdapter', () => {
  const result = parse(report);
  const byTitle = (title: string) => result.attempts.find((attempt) => attempt.title === title);

  it('reads nested suites as the describe path, under the relative spec file', () => {
    expect(byTitle('pays')).toMatchObject({
      status: 'passed',
      specPath: 'cypress/e2e/checkout.cy.ts',
      describePath: ['Checkout'],
    });
    expect(byTitle('saves the card')?.describePath).toEqual(['Checkout', 'Card']);
    expect(result.provenance.producer).toBe('cypress');
  });

  it('keeps a failure message and its screenshot as a reference', () => {
    expect(byTitle('refunds')).toMatchObject({
      status: 'failed',
      error: { message: 'AssertionError: expected 500 to equal 200' },
    });
    expect(byTitle('refunds')?.evidence).toEqual([
      expect.objectContaining({
        byteSize: 0,
        metadata: expect.objectContaining({ path: 'cypress/screenshots/refunds (failed).png' }),
      }),
    ]);
  });

  it('reads pending and skipped as skipped, and a test with no state as unknown', () => {
    expect(byTitle('exports')?.status).toBe('skipped');
    expect(byTitle('saves the card')?.status).toBe('skipped');
    expect(byTitle('never ran')).toMatchObject({ status: 'unknown', rawStatus: 'unknown' });
    expect(result.status).toBe('failed');
  });

  it('records one attempt per test, since Mochawesome keeps no retry history', () => {
    expect(result.attempts.every((attempt) => attempt.index === 1)).toBe(true);
  });

  it('refuses a document that is not a Mochawesome report', () => {
    expect(() => parse({ results: { tests: [] } })).toThrow(
      'Mochawesome report has no results array',
    );
  });
});
