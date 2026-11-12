import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createErrorBoundary } from '../errors/boundary.js';
import { apiRateLimitFrom, createApiRateLimit, DEFAULT_API_RATE_LIMIT } from './api-rate-limit.js';

/** Plan task 8: every route but the probes has a per-token and per-client budget. */
function app(limit: number) {
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'R',
  });
  return new Hono()
    .onError(onError)
    .use(
      '*',
      createApiRateLimit({
        limit,
        clientKey: (context) => context.req.header('x-client') ?? 'one',
        now: () => 0,
      }),
    )
    .get('/api/v1/runs', (context) => context.text('ok'))
    .get('/health', (context) => context.text('ok'))
    .post('/api/v1/reporter/events', (context) => context.text('ok'));
}

describe('createApiRateLimit', () => {
  it('answers 429 with retry-after once a client spends its budget', async () => {
    const api = app(2);
    expect((await api.request('/api/v1/runs')).status).toBe(200);
    expect((await api.request('/api/v1/runs')).status).toBe(200);
    const limited = await api.request('/api/v1/runs');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('budgets each token and each client on its own', async () => {
    const api = app(1);
    const token = (value: string) => ({ headers: { authorization: `Bearer ${value}` } });
    expect((await api.request('/api/v1/runs', token('lup_a'))).status).toBe(200);
    expect((await api.request('/api/v1/runs', token('lup_a'))).status).toBe(429);
    expect((await api.request('/api/v1/runs', token('lup_b'))).status).toBe(200);
    expect((await api.request('/api/v1/runs')).status).toBe(200);
    expect((await api.request('/api/v1/runs', { headers: { 'x-client': 'two' } })).status).toBe(
      200,
    );
  });

  it('never limits the probes or the reporter, and is off at zero', async () => {
    const api = app(1);
    for (let index = 0; index < 3; index += 1) {
      expect((await api.request('/health')).status).toBe(200);
      expect((await api.request('/api/v1/reporter/events', { method: 'POST' })).status).toBe(200);
    }
    const off = app(0);
    for (let index = 0; index < 3; index += 1) {
      expect((await off.request('/api/v1/runs')).status).toBe(200);
    }
  });
});

describe('apiRateLimitFrom', () => {
  it('reads the environment, defaulting and refusing nonsense', () => {
    expect(apiRateLimitFrom(undefined)).toBe(DEFAULT_API_RATE_LIMIT);
    expect(apiRateLimitFrom(' ')).toBe(DEFAULT_API_RATE_LIMIT);
    expect(apiRateLimitFrom('0')).toBe(0);
    expect(apiRateLimitFrom('120')).toBe(120);
    expect(() => apiRateLimitFrom('-1')).toThrow(/LUPIN_API_RATE_LIMIT/);
    expect(() => apiRateLimitFrom('lots')).toThrow(/LUPIN_API_RATE_LIMIT/);
  });
});
