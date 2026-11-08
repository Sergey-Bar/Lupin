import { afterEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { createOnboardingRoutes } from './onboarding.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const ROLES: Record<string, Caller> = {
  viewer: { actor: 'token:v', role: 'viewer', uploaderFor: null },
  admin: { actor: 'token:a', role: 'admin', uploaderFor: null },
};

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => ROLES[token] ?? null,
    hasSession: async () => false,
  };
  const app: Hono = withErrorBoundary(
    createOnboardingRoutes({
      db: db as never,
      workspaceId: 'ws-1',
      aiConfigured: async () => false,
      access,
    }),
  );
  return (role: string | null, method: string, path: string) =>
    app.request(path, {
      method,
      headers: role === null ? {} : { authorization: `Bearer ${role}` },
    });
}

describe('onboarding routes', () => {
  it('lets a viewer read the checklist and nobody anonymous', async () => {
    const call = await setup();
    expect((await call(null, 'GET', '/api/v1/onboarding')).status).toBe(401);
    const response = await call('viewer', 'GET', '/api/v1/onboarding');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ done: 1, total: 6 });
  });

  it('lets only an admin skip, dismiss and reset', async () => {
    const call = await setup();
    expect((await call('viewer', 'POST', '/api/v1/onboarding/ai/dismiss')).status).toBe(403);
    const skipped = await call('admin', 'POST', '/api/v1/onboarding/ai/dismiss');
    expect(await skipped.json()).toMatchObject({
      steps: expect.arrayContaining([expect.objectContaining({ id: 'ai', state: 'skipped' })]),
    });
    expect((await call('admin', 'POST', '/api/v1/onboarding/nope/dismiss')).status).toBe(404);
    const reset = await call('admin', 'POST', '/api/v1/onboarding/reset');
    expect(await reset.json()).toMatchObject({
      dismissed: false,
      steps: expect.arrayContaining([expect.objectContaining({ id: 'ai', state: 'todo' })]),
    });
  });
});
