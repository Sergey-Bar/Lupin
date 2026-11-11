import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import * as schema from '@lupin/db';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticVaultSecret } from '../test-support/synthetic-credentials.js';
import { createGitHubAppRoutes } from './github-app.js';

const VAULT = syntheticVaultSecret();
const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const ROLES: Record<string, Caller> = {
  viewer: { actor: 'token:v', role: 'viewer', uploaderFor: null },
  operator: { actor: 'token:o', role: 'operator', uploaderFor: null },
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
    createGitHubAppRoutes({ db: db as never, workspaceId: 'ws-1', vaultSecret: VAULT, access }),
  );
  const call = (role: string, method: string, body?: unknown) =>
    app.request('/api/v1/settings/github-app', {
      method,
      headers: { authorization: `Bearer ${role}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { db, call };
}

describe('the GitHub App setting', () => {
  it('is stored by an admin only, and only ever answered as set or not', async () => {
    const { db, call } = await setup();
    expect(await (await call('operator', 'GET')).json()).toEqual({ set: false });
    expect((await call('viewer', 'GET')).status).toBe(403);
    expect((await call('operator', 'PUT', { appId: '42', privateKey: PEM })).status).toBe(403);
    const stored = await call('admin', 'PUT', { appId: '42', privateKey: PEM });
    expect(stored.status).toBe(200);
    const text = await stored.text();
    expect(text).toBe('{"set":true}');
    expect(await (await call('operator', 'GET')).json()).toEqual({ set: true });
    const events = await db.select().from(schema.auditEvents);
    const logged = events.find((event) => event.action === 'github_app.store');
    expect(logged).toBeDefined();
    expect(JSON.stringify(logged)).not.toContain('PRIVATE KEY');
    expect((await call('admin', 'DELETE')).status).toBe(200);
    expect(await (await call('operator', 'GET')).json()).toEqual({ set: false });
  });

  it('refuses a body with no App ID or with something that is not a key', async () => {
    const { call } = await setup();
    expect((await call('admin', 'PUT', { appId: 'abc', privateKey: PEM })).status).toBe(400);
    expect((await call('admin', 'PUT', { appId: '42', privateKey: 'hunter2' })).status).toBe(400);
  });
});
