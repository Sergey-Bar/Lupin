import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { DomainError } from '../errors/domain-error.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticVaultSecret } from '../test-support/synthetic-credentials.js';
import { createSettingsService } from './settings-service.js';

const VAULT = syntheticVaultSecret();
const KEY = ['sk', '-live-', 'abcdefgh', 'wxyz'].join('');
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup(
  env: Record<string, string | undefined> = {},
  vault: { secret?: string } = { secret: VAULT },
) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const service = createSettingsService({
    db: db as never,
    workspaceId: 'ws-1',
    vaultSecret: vault.secret,
    env,
  });
  return { db, service };
}

describe('settings service', () => {
  it('resolves environment over a saved value over the default, and says which', async () => {
    const { service } = await setup();
    expect(await service.read('sessions.ttlHours')).toMatchObject({ source: 'default', value: 24 });
    await service.put('sessions.ttlHours', 12, 'alice');
    expect(await service.read('sessions.ttlHours')).toMatchObject({
      source: 'ui',
      value: 12,
      updatedBy: 'alice',
    });
    expect(await service.resolve('sessions.ttlHours')).toBe(12);

    const { service: pinned } = await setup({ SESSION_TTL_HOURS: '48' });
    expect(await pinned.read('sessions.ttlHours')).toMatchObject({
      source: 'environment',
      value: 48,
    });
  });

  it('refuses to save over an environment variable, naming it', async () => {
    const { service } = await setup({ OLLAMA_BASE_URL: 'http://ollama:11434' });
    const refusal = await service
      .put('ai.ollamaBaseUrl', 'http://other:11434', 'alice')
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(DomainError);
    expect(refusal).toMatchObject({ code: 'ENV_LOCKED', details: { envVar: 'OLLAMA_BASE_URL' } });
  });

  it('refuses an unknown key and an invalid value with a fix', async () => {
    const { service } = await setup();
    await expect(service.put('nope', 1, 'alice')).rejects.toMatchObject({
      code: 'UNKNOWN_SETTING',
    });
    await expect(
      service.put('integrations.githubApiUrl', 'http://ghe.test', 'alice'),
    ).rejects.toMatchObject({
      code: 'INVALID_SETTING',
      details: { fix: expect.any(String) },
    });
  });

  it('seals a secret, masks it in every read, and opens it only in process', async () => {
    const { db, service } = await setup();
    await service.put('ai.apiKey', KEY, 'alice');
    const read = await service.read('ai.apiKey');
    expect(read).toMatchObject({ source: 'ui', value: null, secret: { set: true, last4: 'wxyz' } });
    expect(JSON.stringify(await service.list())).not.toContain(KEY);
    expect(JSON.stringify(await db.select().from(schema.installationSettings))).not.toContain(KEY);
    expect(JSON.stringify(await db.select().from(schema.vaultEntries))).not.toContain(KEY);
    expect(await service.resolve('ai.apiKey')).toBe(KEY);
  });

  it('refuses a secret with no vault configured, naming the fix', async () => {
    const { service } = await setup({}, {});
    await expect(service.put('ai.apiKey', KEY, 'alice')).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('reverts to the default and removes a sealed secret', async () => {
    const { db, service } = await setup();
    await service.put('ai.apiKey', KEY, 'alice');
    await service.revert('ai.apiKey', 'alice');
    expect(await service.read('ai.apiKey')).toMatchObject({
      source: 'unset',
      secret: { set: false },
    });
    expect(await db.select().from(schema.vaultEntries)).toHaveLength(0);
    expect(await service.resolve('ai.apiKey')).toBeUndefined();
  });

  it('serves a cached value until a write invalidates it', async () => {
    const { db, service } = await setup();
    await service.put('retention.sseReplayHours', 400, 'alice');
    expect(await service.resolve('retention.sseReplayHours')).toBe(400);
    // Behind the service's back: the cache must not notice.
    await db.update(schema.installationSettings).set({ value: { value: 1 } });
    expect(await service.resolve('retention.sseReplayHours')).toBe(400);
    await service.put('retention.sseReplayHours', 500, 'alice');
    expect(await service.resolve('retention.sseReplayHours')).toBe(500);
  });

  it('audits a change by key, never by value', async () => {
    const { db, service } = await setup();
    await service.put('ai.apiKey', KEY, 'alice');
    const rows = await db.select().from(schema.auditEvents);
    expect(rows.some((row) => row.action === 'setting.update')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(KEY);
  });

  it('reads booleans and numbers from the environment as their type', async () => {
    const { service } = await setup({
      AUTH_SSO_ENFORCED: 'yes',
      DELIVERY_SYNC_INTERVAL_MS: '30000',
    });
    expect(await service.resolve('identity.ssoEnforced')).toBe(true);
    expect(await service.resolve('integrations.deliverySyncIntervalMs')).toBe(30_000);
  });

  it('tells subscribers which key changed, and stops when unsubscribed', async () => {
    const { service } = await setup();
    const seen: string[] = [];
    const stop = service.subscribe((key) => seen.push(key));
    await service.put('retention.sseReplayHours', 400, 'alice');
    await service.revert('retention.sseReplayHours', 'alice');
    stop();
    await service.put('retention.sseReplayHours', 401, 'alice');
    expect(seen).toEqual(['retention.sseReplayHours', 'retention.sseReplayHours']);
  });

  it('keeps notifying the others when one subscriber throws', async () => {
    const { service } = await setup();
    const seen: string[] = [];
    service.subscribe(() => {
      throw new Error('boom');
    });
    service.subscribe((key) => seen.push(key));
    await service.put('retention.sseReplayHours', 400, 'alice');
    expect(seen).toEqual(['retention.sseReplayHours']);
  });

  it('does not miss another instance change made after a local save', async () => {
    const { db, service } = await setup();
    const other = createSettingsService({
      db: db as never,
      workspaceId: 'ws-1',
      vaultSecret: VAULT,
      env: {},
    });
    const seen: string[] = [];
    await service.refresh();
    service.subscribe((key) => seen.push(key));
    await other.put('retention.sessionDays', 7, 'bob');
    await service.put('sessions.ttlHours', 8, 'alice');
    expect(await service.refresh()).toContain('retention.sessionDays');
    expect(seen).toContain('retention.sessionDays');
  });

  it('tells this instance about a change another instance saved, once', async () => {
    const { db, service } = await setup();
    const other = createSettingsService({
      db: db as never,
      workspaceId: 'ws-1',
      vaultSecret: VAULT,
      env: {},
    });
    const seen: string[] = [];
    service.subscribe((key) => seen.push(key));
    expect(await service.resolve('retention.sessionDays')).toBe(30);
    expect(await service.refresh()).toEqual([]);
    await other.put('retention.sessionDays', 7, 'bob');
    // Still the cached value until the poll runs.
    expect(await service.resolve('retention.sessionDays')).toBe(30);
    expect(await service.refresh()).toEqual(['retention.sessionDays']);
    expect(await service.resolve('retention.sessionDays')).toBe(7);
    expect(seen).toEqual(['retention.sessionDays']);
    expect(await service.refresh()).toEqual([]);
    await other.revert('retention.sessionDays', 'bob');
    expect(await service.refresh()).toEqual(['retention.sessionDays']);
    expect(await service.resolve('retention.sessionDays')).toBe(30);
  });

  it('re-opens a secret another instance replaced', async () => {
    const { db, service } = await setup();
    const other = createSettingsService({
      db: db as never,
      workspaceId: 'ws-1',
      vaultSecret: VAULT,
      env: {},
    });
    await service.put('ai.apiKey', KEY, 'alice');
    expect(await service.resolve('ai.apiKey')).toBe(KEY);
    const next = ['sk', '-live-', 'zzzzzzzz', 'qqqq'].join('');
    await other.put('ai.apiKey', next, 'bob');
    await service.refresh();
    expect(await service.resolve('ai.apiKey')).toBe(next);
  });

  it('answers from the environment and defaults alone with no database', async () => {
    const service = createSettingsService({
      workspaceId: 'ws-1',
      env: { OLLAMA_BASE_URL: 'http://o:1' },
    });
    expect(await service.resolve('ai.ollamaBaseUrl')).toBe('http://o:1');
    expect(await service.resolve('sessions.ttlHours')).toBe(24);
    await expect(service.put('sessions.ttlHours', 3, 'a')).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });
});
