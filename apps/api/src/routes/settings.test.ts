import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticVaultSecret } from '../test-support/synthetic-credentials.js';
import { createSettingsService } from '../services/settings-service.js';
import { createSettingsRoutes, type SettingTesters } from './settings.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const KEY = ['kilo', '-key-', 'abcd', '9876'].join('');

async function setup(
  caller: Caller,
  env: Record<string, string> = {},
  testers: SettingTesters = {},
) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const settings = createSettingsService({
    db: db as never,
    workspaceId: 'ws-1',
    vaultSecret: syntheticVaultSecret(),
    env,
  });
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async () => caller,
    hasSession: async () => false,
  };
  const app: Hono = withErrorBoundary(createSettingsRoutes({ access, settings, testers }));
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { call, settings };
}

// A workspace token is an admin of its own workspace only; the installation session is the install's.
const INSTALL_ADMIN: Caller = { actor: 'session', role: 'admin', uploaderFor: null };
const WORKSPACE_ADMIN: Caller = { actor: 'token:a', role: 'admin', uploaderFor: null };
const OPERATOR: Caller = { actor: 'token:o', role: 'operator', uploaderFor: null };

describe('settings routes', () => {
  it('lists every setting with its source, and masks secrets', async () => {
    const { call, settings } = await setup(INSTALL_ADMIN);
    await settings.put('ai.apiKey', KEY, 'session');
    const response = await call('GET', '/api/v1/settings');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text) as {
      settings: Array<{ key: string; secret?: { last4: string } }>;
    };
    expect(body.settings.find((row) => row.key === 'ai.apiKey')?.secret?.last4).toBe('9876');
  });

  it('saves a value and reads it back as saved from the interface', async () => {
    const { call } = await setup(INSTALL_ADMIN);
    const put = await call('PUT', '/api/v1/settings/ai.ollamaBaseUrl', {
      value: 'http://ollama:11434',
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ source: 'ui', value: 'http://ollama:11434' });
  });

  it('answers 409 ENV_LOCKED with the variable and a fix', async () => {
    const { call } = await setup(INSTALL_ADMIN, { OLLAMA_BASE_URL: 'http://o:1' });
    const put = await call('PUT', '/api/v1/settings/ai.ollamaBaseUrl', { value: 'http://x:1' });
    expect(put.status).toBe(409);
    expect(await put.json()).toMatchObject({
      error: {
        code: 'ENV_LOCKED',
        details: { envVar: 'OLLAMA_BASE_URL', fix: expect.any(String) },
      },
    });
  });

  it('answers 400 for an invalid value and 404 for an unknown key', async () => {
    const { call } = await setup(INSTALL_ADMIN);
    expect((await call('PUT', '/api/v1/settings/sessions.ttlHours', { value: -1 })).status).toBe(
      400,
    );
    expect((await call('PUT', '/api/v1/settings/sessions.ttlHours', 'nope')).status).toBe(400);
    expect((await call('PUT', '/api/v1/settings/nope', { value: 1 })).status).toBe(404);
  });

  it('refuses a workspace admin an installation setting, naming who can', async () => {
    const { call } = await setup(WORKSPACE_ADMIN);
    const put = await call('PUT', '/api/v1/settings/sessions.ttlHours', { value: 8 });
    expect(put.status).toBe(403);
    expect(await put.json()).toMatchObject({ error: { code: 'INSTALLATION_ADMIN_REQUIRED' } });
    expect((await call('DELETE', '/api/v1/settings/sessions.ttlHours')).status).toBe(403);
  });

  it('refuses an operator everything', async () => {
    const { call } = await setup(OPERATOR);
    expect((await call('GET', '/api/v1/settings')).status).toBe(403);
    expect((await call('PUT', '/api/v1/settings/sessions.ttlHours', { value: 8 })).status).toBe(
      403,
    );
  });

  it('reverts a saved value to its default', async () => {
    const { call } = await setup(INSTALL_ADMIN);
    await call('PUT', '/api/v1/settings/sessions.ttlHours', { value: 8 });
    const reverted = await call('DELETE', '/api/v1/settings/sessions.ttlHours');
    expect(await reverted.json()).toMatchObject({ source: 'default', value: 24 });
  });

  it('tests a draft value without saving it', async () => {
    const tester = vi.fn(async () => ({ ok: true, message: 'Connected: 3 models.' }));
    const { call, settings } = await setup(INSTALL_ADMIN, {}, { ai: tester });
    const response = await call('POST', '/api/v1/settings/ai.ollamaBaseUrl/test', {
      value: 'http://ollama:11434',
    });
    expect(await response.json()).toEqual({ ok: true, message: 'Connected: 3 models.' });
    expect(tester).toHaveBeenCalledWith(
      expect.objectContaining({ 'ai.ollamaBaseUrl': 'http://ollama:11434' }),
    );
    expect((await settings.read('ai.ollamaBaseUrl')).source).toBe('unset');
  });

  it('tests what is in effect when the draft is empty', async () => {
    const tester = vi.fn(async () => ({ ok: true, message: 'ok' }));
    const { call, settings } = await setup(INSTALL_ADMIN, {}, { ai: tester });
    await settings.put('ai.ollamaBaseUrl', 'http://saved:11434', 'session');
    await call('POST', '/api/v1/settings/ai.ollamaBaseUrl/test', { value: '' });
    expect(tester).toHaveBeenCalledWith(
      expect.objectContaining({ 'ai.ollamaBaseUrl': 'http://saved:11434' }),
    );
  });

  it('reports a draft the schema refuses as a failed test, not a 500', async () => {
    const { call } = await setup(INSTALL_ADMIN);
    const response = await call('POST', '/api/v1/settings/integrations.githubApiUrl/test', {
      value: 'http://ghe.test',
    });
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it('turns a tester that throws into a failed test with its reason', async () => {
    const { call } = await setup(
      INSTALL_ADMIN,
      {},
      {
        ai: async () => {
          throw new Error('connect ECONNREFUSED');
        },
      },
    );
    const response = await call('POST', '/api/v1/settings/ai.ollamaBaseUrl/test', {
      value: 'http://o:1',
    });
    expect(await response.json()).toMatchObject({
      ok: false,
      message: expect.stringContaining('ECONNREFUSED'),
    });
  });
});
