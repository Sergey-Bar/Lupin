import { describe, expect, it } from 'vitest';
import { app } from './index.js';

/**
 * The composed app puts `Idempotency-Key` in front of the create routes it lists (plan
 * 1795712849115 task 5). The middleware's own suite proves what it does; this proves the
 * composition root actually mounted it, which a unit test of the middleware cannot.
 */
describe('Idempotency-Key in the composed API', () => {
  it('makes one quality gate for two identical keyed creates', async () => {
    const name = `idem-${String(Date.now())}`;
    const send = async () =>
      await app.request('/api/v1/dashboard/quality-gates', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': name },
        body: JSON.stringify({ name, passRateThreshold: 90 }),
      });

    const first = await send();
    const repeat = await send();

    expect(first.status).toBe(201);
    expect(repeat.status).toBe(201);
    expect(repeat.headers.get('x-idempotent-replay')).toBe('true');
    expect(await repeat.json()).toEqual(await first.json());

    const list = await app.request('/api/v1/dashboard/quality-gates');
    const gates = (await list.json()) as Array<{ name: string }>;
    expect(gates.filter((gate) => gate.name === name)).toHaveLength(1);
  });
});
