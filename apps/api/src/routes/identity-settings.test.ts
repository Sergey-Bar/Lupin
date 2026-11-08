import { afterEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { createIdentityDrafts } from '../services/identity-settings.js';
import { createSettingsService } from '../services/settings-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticVaultSecret } from '../test-support/synthetic-credentials.js';
import { createIdentitySettingsRoutes } from './identity-settings.js';
import { createSettingsRoutes } from './settings.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const INSTALL_ADMIN: Caller = { actor: 'session', role: 'admin', uploaderFor: null };
const WORKSPACE_ADMIN: Caller = { actor: 'token:a', role: 'admin', uploaderFor: null };
const CLOUDFLARE_ADMIN: Caller = { actor: 'cf:alice@acme.test', role: 'admin', uploaderFor: null };
const SECRET = ['client', '-secret-', 'value'].join('');

const OIDC = {
  'identity.oidcIssuer': 'https://acme.okta.test',
  'identity.oidcClientId': 'lupin',
  'identity.oidcClientSecret': SECRET,
  'identity.oidcRoleMap': 'admin:alice@acme.test, viewer:group:eng',
};

async function setup(caller: Caller) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const settings = createSettingsService({
    db: db as never,
    workspaceId: 'ws-1',
    vaultSecret: syntheticVaultSecret(),
    env: {},
  });
  const drafts = createIdentityDrafts();
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async () => caller,
    hasSession: async () => false,
  };
  const app: Hono = withErrorBoundary(
    createIdentitySettingsRoutes({
      access,
      settings,
      drafts,
      publicAppUrl: 'https://lupin.acme.test',
      breakGlass: false,
    }),
  );
  const plain: Hono = withErrorBoundary(createSettingsRoutes({ access, settings, testers: {} }));
  const call = (target: Hono, method: string, path: string, body?: unknown) =>
    target.request(path, {
      method,
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, plain, call, settings, drafts };
}

describe('identity settings routes', () => {
  it('refuses a sign-in setting saved field by field, naming the test sign-in', async () => {
    const { plain, call } = await setup(INSTALL_ADMIN);
    const response = await call(plain, 'PUT', '/api/v1/settings/identity.oidcRoleMap', {
      value: 'admin:a@b.test',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_VERIFIED', details: { fix: expect.stringContaining('Test sign-in') } },
    });
    expect((await call(plain, 'DELETE', '/api/v1/settings/identity.oidcRoleMap')).status).toBe(409);
  });

  it('saves a draft and says a test sign-in is needed, with the URL that starts it', async () => {
    const { app, call } = await setup(INSTALL_ADMIN);
    const response = await call(app, 'POST', '/api/v1/settings/identity/draft', { values: OIDC });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; needsTest: boolean; testUrl: string };
    expect(body).toMatchObject({
      needsTest: true,
      testUrl: `/api/v1/auth/oidc/test?draft=${body.id}`,
    });
  });

  it('refuses a draft with an invalid role map, naming the rule', async () => {
    const { app, call } = await setup(INSTALL_ADMIN);
    const response = await call(app, 'POST', '/api/v1/settings/identity/draft', {
      values: { ...OIDC, 'identity.oidcRoleMap': 'boss:alice' },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'INVALID_SETTING',
        details: { fields: { 'identity.oidcRoleMap': expect.any(String) } },
      },
    });
  });

  it('refuses to apply an untested OIDC draft', async () => {
    const { app, call } = await setup(INSTALL_ADMIN);
    const draft = (await (
      await call(app, 'POST', '/api/v1/settings/identity/draft', { values: OIDC })
    ).json()) as { id: string };
    const applied = await call(app, 'POST', '/api/v1/settings/identity/apply', {
      draftId: draft.id,
    });
    expect(applied.status).toBe(409);
    expect(await applied.json()).toMatchObject({ error: { code: 'NOT_VERIFIED' } });
  });

  it('refuses a draft under which the tester is no longer an admin, naming the group', async () => {
    const { app, call, drafts, settings } = await setup(INSTALL_ADMIN);
    const draft = (await (
      await call(app, 'POST', '/api/v1/settings/identity/draft', { values: OIDC })
    ).json()) as { id: string };
    drafts.verify(draft.id, { email: 'bob@acme.test', groups: ['eng'], role: 'viewer' });
    const applied = await call(app, 'POST', '/api/v1/settings/identity/apply', {
      draftId: draft.id,
    });
    expect(applied.status).toBe(409);
    expect(await applied.json()).toMatchObject({
      error: { code: 'WOULD_LOCK_OUT', message: expect.stringContaining('`eng` maps to viewer') },
    });
    expect((await settings.read('identity.oidcRoleMap')).source).toBe('unset');
  });

  it('applies a draft whose test sign-in came back an admin, and keeps the secret sealed', async () => {
    const { app, call, drafts, settings } = await setup(INSTALL_ADMIN);
    const draft = (await (
      await call(app, 'POST', '/api/v1/settings/identity/draft', { values: OIDC })
    ).json()) as { id: string };
    drafts.verify(draft.id, { email: 'alice@acme.test', groups: [], role: 'admin' });
    const status = await call(app, 'GET', `/api/v1/settings/identity/draft/${draft.id}`);
    expect(await status.json()).toMatchObject({
      verified: { email: 'alice@acme.test', role: 'admin' },
    });
    const applied = await call(app, 'POST', '/api/v1/settings/identity/apply', {
      draftId: draft.id,
    });
    expect(applied.status).toBe(200);
    expect(await applied.text()).not.toContain(SECRET);
    expect(await settings.read('identity.oidcRoleMap')).toMatchObject({
      source: 'ui',
      value: OIDC['identity.oidcRoleMap'],
    });
    expect(await settings.resolve('identity.oidcClientSecret')).toBe(SECRET);
    // A draft is applied once.
    expect(
      (await call(app, 'POST', '/api/v1/settings/identity/apply', { draftId: draft.id })).status,
    ).toBe(404);
  });

  it('applies a Cloudflare rule change from the installation key without a test, and refuses it from inside Access', async () => {
    const values = { 'identity.cfAccessRoleMap': 'admin:alice@acme.test' };
    const key = await setup(INSTALL_ADMIN);
    const draft = (await (
      await key.call(key.app, 'POST', '/api/v1/settings/identity/draft', { values })
    ).json()) as { id: string; needsTest: boolean };
    expect(draft.needsTest).toBe(false);
    expect(
      (await key.call(key.app, 'POST', '/api/v1/settings/identity/apply', { draftId: draft.id }))
        .status,
    ).toBe(200);

    const inside = await setup(CLOUDFLARE_ADMIN);
    const second = (await (
      await inside.call(inside.app, 'POST', '/api/v1/settings/identity/draft', { values })
    ).json()) as { id: string };
    const refused = await inside.call(inside.app, 'POST', '/api/v1/settings/identity/apply', {
      draftId: second.id,
    });
    expect(await refused.json()).toMatchObject({
      error: {
        code: 'NOT_VERIFIED',
        details: { fix: expect.stringContaining('installation key') },
      },
    });
  });

  it('refuses a workspace admin every identity route', async () => {
    const { app, call } = await setup(WORKSPACE_ADMIN);
    expect(
      (await call(app, 'POST', '/api/v1/settings/identity/draft', { values: OIDC })).status,
    ).toBe(403);
    expect(
      (await call(app, 'POST', '/api/v1/settings/identity/apply', { draftId: 'x' })).status,
    ).toBe(403);
  });
});
