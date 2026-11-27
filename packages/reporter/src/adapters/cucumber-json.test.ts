import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { cucumberJsonAdapter, worstStatus } from './cucumber-json.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://cucumber',
  sourceDigest: 'b'.repeat(64),
  producerVersion: '11.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-11-26T10:00:00.000Z',
  finishedAt: '2026-11-26T10:01:00.000Z',
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const step = (keyword: string, name: string, status: string, extra: object = {}) => ({
  keyword,
  name,
  line: 1,
  result: { status, duration: 2_000_000, ...extra },
});

/** As cucumber-js `--format json` writes it, including an outline and a background. */
const REPORT = [
  {
    uri: 'features/checkout.feature',
    id: 'checkout',
    keyword: 'Feature',
    name: 'Checkout',
    elements: [
      {
        type: 'background',
        keyword: 'Background',
        name: '',
        steps: [step('Given ', 'a signed-in shopper', 'passed')],
      },
      {
        type: 'scenario',
        keyword: 'Scenario',
        id: 'checkout;pays-by-card',
        name: 'Pays by card',
        line: 6,
        steps: [
          step('When ', 'they pay', 'passed'),
          step('Then ', 'the order is placed', 'passed'),
        ],
      },
      {
        type: 'background',
        keyword: 'Background',
        name: '',
        steps: [step('Given ', 'a signed-in shopper', 'passed')],
      },
      {
        type: 'scenario',
        keyword: 'Scenario Outline',
        name: 'Applies a coupon',
        line: 14,
        steps: [
          step('Then ', 'the total is 90', 'failed', { error_message: 'expected 90, got 100' }),
        ],
      },
      {
        type: 'background',
        keyword: 'Background',
        name: '',
        steps: [step('Given ', 'a signed-in shopper', 'passed')],
      },
      {
        type: 'scenario',
        keyword: 'Scenario Outline',
        name: 'Applies a coupon',
        line: 15,
        steps: [step('Then ', 'the total is 80', 'passed')],
      },
      {
        type: 'background',
        keyword: 'Background',
        name: '',
        steps: [
          step('Given ', 'a signed-in shopper', 'failed', { error_message: 'login page 500' }),
        ],
      },
      {
        type: 'scenario',
        keyword: 'Scenario',
        name: 'Refunds',
        line: 20,
        steps: [step('When ', 'they ask for a refund', 'skipped')],
      },
      {
        type: 'scenario',
        keyword: 'Scenario',
        name: 'Gift wraps',
        line: 25,
        steps: [step('When ', 'they wrap it', 'undefined')],
      },
    ],
  },
];

describe('worstStatus', () => {
  it.each([
    [['passed', 'passed'], 'passed'],
    [['passed', 'skipped'], 'skipped'],
    [['skipped', 'failed', 'passed'], 'failed'],
    [['passed', 'weird'], 'weird'],
    [['weird', 'failed'], 'failed'],
    [[], ''],
  ])('%j is %j', (statuses, expected) => {
    expect(worstStatus(statuses)).toBe(expected);
  });
});

describe('the Cucumber JSON adapter', () => {
  const result = cucumberJsonAdapter.parse(encode(REPORT), context);
  const byTitle = new Map(result.attempts.map((attempt) => [attempt.title, attempt]));

  it('tells the rows of an outline apart by line, so they are not read as a flaky test', () => {
    expect(byTitle.get('Applies a coupon (line 14)')?.status).toBe('failed');
    expect(byTitle.get('Applies a coupon (line 15)')?.status).toBe('passed');
    expect(result.attempts.every((attempt) => attempt.flakiness === 'unknown')).toBe(true);
  });

  it('counts the background in the scenario, so a failed background fails it', () => {
    const refunds = byTitle.get('Refunds');
    expect(refunds?.status).toBe('failed');
    expect(refunds?.error?.message).toBe('login page 500');
  });

  it('fails a scenario with an undefined step, as strict Cucumber does', () => {
    expect(byTitle.get('Gift wraps')?.status).toBe('failed');
  });

  it('reads the feature as the file and describe path, and durations from nanoseconds', () => {
    expect(byTitle.get('Pays by card')).toMatchObject({
      status: 'passed',
      specPath: 'features/checkout.feature',
      describePath: ['Checkout'],
      durationMs: 6,
    });
    expect(result.steps.some((s) => s.id.includes('When they pay'))).toBe(true);
  });

  it.each([
    ['an object', { features: [] }, /array of features/u],
    ['no scenarios', [{ uri: 'a.feature', elements: [] }], /no tests/u],
  ])('refuses %s', (_name, body, message) => {
    expect(() => cucumberJsonAdapter.parse(encode(body), context)).toThrow(message);
  });
});
