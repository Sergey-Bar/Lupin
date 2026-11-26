import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Hono } from 'hono';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { createIdempotency } from './idempotency.js';

/**
 * IDEM-1: over any sequence of keyed create requests, the number of records made equals the
 * number of distinct (key, body) pairs whose key was first used with that body, and every
 * repeat answers exactly what the first answered.
 */

const SEED = 20261126;
const RUNS = 60;

const request = fc.record({
  key: fc.constantFrom('a', 'b', 'c'),
  body: fc.constantFrom('x', 'y'),
});

async function play(requests: Array<{ key: string; body: string }>) {
  let made = 0;
  const app = withErrorBoundary(new Hono());
  app.use('/things', createIdempotency());
  app.post('/things', async (c) => {
    made += 1;
    return c.json({ n: made, body: ((await c.req.json()) as { b: string }).b }, 201);
  });
  const answers: Array<{ status: number; text: string }> = [];
  for (const r of requests) {
    const response = await app.request('/things', {
      method: 'POST',
      headers: { 'idempotency-key': r.key, 'content-type': 'application/json' },
      body: JSON.stringify({ b: r.body }),
    });
    answers.push({ status: response.status, text: await response.text() });
  }
  return { made, answers };
}

/** The model: the first body seen for a key wins, and only it ever runs. */
function model(requests: Array<{ key: string; body: string }>) {
  const first = new Map<string, string>();
  for (const r of requests) if (!first.has(r.key)) first.set(r.key, r.body);
  return first;
}

describe('IDEM-1: a keyed create runs once per key', () => {
  it('makes one record per key, and answers every repeat with the first answer', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(request, { maxLength: 12 }), async (requests) => {
        const { made, answers } = await play(requests);
        const first = model(requests);
        expect(made).toBe(first.size);
        const kept = new Map<string, string>();
        requests.forEach((r, i) => {
          const answer = answers[i];
          if (first.get(r.key) !== r.body) {
            expect(answer?.status).toBe(409);
            return;
          }
          expect(answer?.status).toBe(201);
          const seen = kept.get(r.key);
          if (seen === undefined) kept.set(r.key, answer?.text ?? '');
          else expect(answer?.text).toBe(seen);
        });
      }),
      {
        seed: SEED,
        numRuns: RUNS,
        examples: [
          [
            [
              { key: 'a', body: 'x' },
              { key: 'a', body: 'x' },
              { key: 'a', body: 'y' },
            ],
          ],
        ],
      },
    );
  });

  it('the property harness can fail: without the middleware a repeat makes a second record', async () => {
    let made = 0;
    const app = new Hono();
    app.post('/things', (c) => {
      made += 1;
      return c.json({}, 201);
    });
    for (let i = 0; i < 2; i += 1) {
      await app.request('/things', { method: 'POST', headers: { 'idempotency-key': 'a' } });
    }
    expect(made).not.toBe(model([{ key: 'a', body: '' }]).size);
  });
});
