import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { createIdempotency, IDEMPOTENT_CREATE_ROUTES } from './idempotency.js';

/** A create route that counts what it made, so a repeat that ran again is visible. */
function harness(options: Parameters<typeof createIdempotency>[0] = {}) {
  let created = 0;
  let fail: number | null = null;
  const app = withErrorBoundary(new Hono());
  app.use('/api/v1/things', createIdempotency(options));
  app.post('/api/v1/things', async (c) => {
    const body = (await c.req.json()) as { name: string };
    if (fail !== null) return c.json({ error: 'refused' }, fail as 400);
    created += 1;
    return c.json({ id: created, name: body.name }, 201);
  });
  const post = async (body: unknown, key?: string, auth = 'Bearer one') =>
    await app.request('/api/v1/things', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: auth,
        ...(key === undefined ? {} : { 'idempotency-key': key }),
      },
      body: JSON.stringify(body),
    });
  return {
    post,
    created: () => created,
    failWith: (status: number | null) => {
      fail = status;
    },
  };
}

describe('Idempotency-Key on a create route', () => {
  it('runs the first request and replays its answer for a repeat, making one record', async () => {
    const h = harness();
    const first = await h.post({ name: 'a' }, 'k-1');
    const repeat = await h.post({ name: 'a' }, 'k-1');

    expect(first.status).toBe(201);
    expect(first.headers.get('x-idempotent-replay')).toBe('false');
    expect(repeat.status).toBe(201);
    expect(repeat.headers.get('x-idempotent-replay')).toBe('true');
    expect(await repeat.json()).toEqual(await first.json());
    expect(h.created()).toBe(1);
  });

  it('refuses the same key with a different body rather than answering for it', async () => {
    const h = harness();
    await h.post({ name: 'a' }, 'k-1');
    const reused = await h.post({ name: 'b' }, 'k-1');

    expect(reused.status).toBe(409);
    expect(((await reused.json()) as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(h.created()).toBe(1);
  });

  it('keeps two callers apart even when they choose the same key', async () => {
    const h = harness();
    await h.post({ name: 'a' }, 'k-1', 'Bearer one');
    const other = await h.post({ name: 'a' }, 'k-1', 'Bearer two');

    expect(other.headers.get('x-idempotent-replay')).toBe('false');
    expect(h.created()).toBe(2);
  });

  it('forgets a refusal, so the retry it invites runs', async () => {
    const h = harness();
    h.failWith(400);
    expect((await h.post({ name: 'a' }, 'k-1')).status).toBe(400);
    h.failWith(null);
    const retry = await h.post({ name: 'a' }, 'k-1');

    expect(retry.status).toBe(201);
    expect(retry.headers.get('x-idempotent-replay')).toBe('false');
    expect(h.created()).toBe(1);
  });

  it('passes a request with no key through untouched, as it always did', async () => {
    const h = harness();
    await h.post({ name: 'a' });
    const second = await h.post({ name: 'a' });

    expect(second.headers.get('x-idempotent-replay')).toBeNull();
    expect(h.created()).toBe(2);
  });

  it('runs a repeat again once the window has passed', async () => {
    let clock = 0;
    const h = harness({ ttlMs: 1000, now: () => clock });
    await h.post({ name: 'a' }, 'k-1');
    clock = 1001;
    await h.post({ name: 'a' }, 'k-1');

    expect(h.created()).toBe(2);
  });

  it('keeps at most maxEntries answers, dropping the oldest first', async () => {
    const h = harness({ maxEntries: 2 });
    await h.post({ name: 'a' }, 'k-1');
    await h.post({ name: 'a' }, 'k-2');
    await h.post({ name: 'a' }, 'k-3');
    // k-1 was dropped to make room, so it runs again; k-3 is still kept.
    await h.post({ name: 'a' }, 'k-1');
    expect(h.created()).toBe(4);
  });

  it.each([[''], ['   '], ['x'.repeat(256)], ['has space'], ['tab\there']])(
    'refuses %j as a key instead of keying on it',
    async (key) => {
      const h = harness();
      const response = await h.post({ name: 'a' }, key);
      expect(response.status).toBe(400);
      expect(h.created()).toBe(0);
    },
  );

  it('refuses a repeat that arrives while the first is still running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = withErrorBoundary(new Hono());
    app.use('/slow', createIdempotency());
    app.post('/slow', async (c) => {
      await gate;
      return c.json({ ok: true }, 201);
    });
    const send = () =>
      app.request('/slow', {
        method: 'POST',
        headers: { 'idempotency-key': 'k', 'content-type': 'application/json' },
        body: '{}',
      });
    const first = send();
    const second = await send();
    release();

    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_KEY_IN_FLIGHT',
    );
    expect((await first).status).toBe(201);
  });
});

describe('the routes it guards', () => {
  it('names no route that issues a credential', () => {
    for (const route of IDEMPOTENT_CREATE_ROUTES) {
      expect(route).not.toMatch(/token|pair|auth|scim|login/u);
    }
  });
});
