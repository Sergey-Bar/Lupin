import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { newmanJsonAdapter } from './newman-json.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://newman',
  sourceDigest: 'd'.repeat(64),
  producerVersion: '6.2.1',
  adapterVersion: '1.0.0',
  startedAt: '2026-11-26T10:00:00.000Z',
  finishedAt: '2026-11-26T10:01:00.000Z',
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const execution = (name: string, assertions: object[], extra: object = {}, iteration = 0) => ({
  cursor: { iteration, position: 0 },
  item: { id: name, name },
  response: { code: 200, responseTime: 42 },
  assertions,
  ...extra,
});

/** `newman run shop.postman_collection.json -r json`, trimmed. */
const report = (executions: object[], iterations = 1, failures: object[] = []) => ({
  collection: { info: { name: 'Shop API' } },
  run: { stats: { iterations: { total: iterations, failed: 0 } }, executions, failures },
});

describe('the Newman adapter', () => {
  const result = newmanJsonAdapter.parse(
    encode(
      report([
        execution('List products', [
          { assertion: 'Status code is 200' },
          { assertion: 'Has items' },
        ]),
        execution('Create order', [
          {
            assertion: 'Status code is 201',
            error: { name: 'AssertionError', message: 'expected 500 to equal 201' },
          },
        ]),
        execution('Health', []),
        execution('Pay', [], {
          requestError: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:3000' },
        }),
      ]),
    ),
    context,
  );
  const byTitle = new Map(result.attempts.map((attempt) => [attempt.title, attempt]));

  it('reads a request as a test and its assertions as steps', () => {
    expect(byTitle.get('List products')).toMatchObject({
      status: 'passed',
      durationMs: 42,
      specPath: 'Shop API.postman_collection.json',
    });
    expect(result.steps.filter((s) => s.id.includes('List products'))).toHaveLength(2);
  });

  it('fails a request whose assertion failed, with the assertion message', () => {
    expect(byTitle.get('Create order')?.status).toBe('failed');
    expect(byTitle.get('Create order')?.error?.message).toContain('expected 500 to equal 201');
  });

  it('fails a request that never got an answer, and reads one that asserted nothing as unknown', () => {
    expect(byTitle.get('Pay')?.status).toBe('failed');
    expect(byTitle.get('Pay')?.error?.message).toContain('ECONNREFUSED');
    expect(byTitle.get('Health')?.status).toBe('unknown');
  });

  it('reads iterations of a data-driven run as separate tests, not as retries', () => {
    const run = newmanJsonAdapter.parse(
      encode(
        report(
          [
            execution(
              'Login',
              [{ assertion: 'ok', error: { name: 'AssertionError', message: 'bad user' } }],
              {},
              0,
            ),
            execution('Login', [{ assertion: 'ok' }], {}, 1),
          ],
          2,
        ),
      ),
      context,
    );
    expect(run.attempts.map((attempt) => [attempt.project, attempt.status])).toEqual([
      ['iteration 1', 'failed'],
      ['iteration 2', 'passed'],
    ]);
    expect(run.attempts.every((attempt) => attempt.flakiness === 'unknown')).toBe(true);
  });

  it('refuses a document that is not a Newman run', () => {
    expect(() => newmanJsonAdapter.parse(encode({ info: {} }), context)).toThrow(
      /run\.executions/u,
    );
  });
});
