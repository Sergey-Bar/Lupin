import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createErrorBoundary } from '../errors/boundary.js';
import { CreateAccessTokenBodySchema, type Caller } from '../services/access-service.js';
import { requireRole, type CallerResolver } from './roles.js';
import { permissionForRequest, scopeAdmits } from './token-scope.js';

/** Plan task 7: a token's scopes narrow its role, through the role guard every route has. */
describe('permissionForRequest', () => {
  it.each([
    ['GET', '/api/v1/runs/1', 'runs:read'],
    ['POST', '/api/v1/runs', 'runs:write'],
    ['GET', '/api/v1/projects/p/tests?x=1', 'tests:read'],
    ['PATCH', '/api/v1/projects/p/tests/t', 'tests:write'],
    ['GET', '/api/v1/settings/gates', 'settings:read'],
    ['DELETE', '/api/v1/access-tokens/1', 'settings:write'],
    ['POST', '/api/v1/copilot/ask', 'ai:use'],
    ['PUT', '/api/v1/integrations/jira', 'connectors:manage'],
    ['GET', '/api/v1/integrations', 'settings:read'],
  ])('%s %s needs %s', (method, path, permission) => {
    expect(permissionForRequest(method, path)).toBe(permission);
  });

  it('admits everything for a token without scopes', () => {
    expect(scopeAdmits(null, 'DELETE', '/api/v1/settings')).toBe(true);
    expect(scopeAdmits(undefined, 'DELETE', '/api/v1/settings')).toBe(true);
  });
});

describe('requireRole with a scoped token', () => {
  const scoped: Caller = {
    actor: 'token:t1',
    role: 'operator',
    uploaderFor: null,
    scopes: ['runs:read'],
  };
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async () => scoped,
    hasSession: async () => false,
  };
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'R',
  });
  const app = new Hono()
    .onError(onError)
    .get('/api/v1/runs', requireRole('viewer', access), (context) => context.text('ok'))
    .post('/api/v1/runs', requireRole('operator', access), (context) => context.text('ok'));
  const headers = { authorization: 'Bearer lup_x' };

  it('lets the scope through', async () => {
    expect((await app.request('/api/v1/runs', { headers })).status).toBe(200);
  });

  it('refuses what the role allows and the scope does not', async () => {
    const response = await app.request('/api/v1/runs', { method: 'POST', headers });
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/not scoped for runs:write/);
  });
});

describe('CreateAccessTokenBodySchema scopes', () => {
  it('accepts a subset of the role', () => {
    expect(
      CreateAccessTokenBodySchema.safeParse({ name: 'ci', role: 'viewer', scopes: ['runs:read'] })
        .success,
    ).toBe(true);
  });

  it('refuses a scope beyond the role', () => {
    const parsed = CreateAccessTokenBodySchema.safeParse({
      name: 'ci',
      role: 'viewer',
      scopes: ['runs:write'],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses scopes on an uploader and the admin spelling anywhere', () => {
    const project = '00000000-0000-4000-8000-000000000000';
    expect(
      CreateAccessTokenBodySchema.safeParse({
        name: 'ci',
        role: 'uploader',
        projectId: project,
        scopes: ['runs:write'],
      }).success,
    ).toBe(false);
    expect(
      CreateAccessTokenBodySchema.safeParse({ name: 'ci', role: 'admin', scopes: ['admin'] })
        .success,
    ).toBe(false);
  });
});
