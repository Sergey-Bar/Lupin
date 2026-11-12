import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticVaultSecret } from '../test-support/synthetic-credentials.js';
import {
  appJwt,
  createGitHubAppTokens,
  deleteGitHubApp,
  hasGitHubApp,
  storeGitHubApp,
} from './github-app-service.js';
import { storeVaultSecret } from './vault-secrets.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

// A key made for this run, never a literal: a PEM in the tree is what the secret scanners look for.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const NOW = new Date('2026-11-11T12:00:00.000Z');
const VAULT = syntheticVaultSecret();
// Assembled at runtime, like every credential-shaped value in a test.
const INSTALLATION_TOKEN = ['ghs_', 'installation', '_one'].join('');

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  return { vault: { db: db as never, workspaceId: 'ws-1', vaultSecret: VAULT } };
}

function github(options: { installed?: boolean; expiresAt?: string } = {}) {
  const calls: Array<{ url: string; method: string; authorization: string }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({
      url: String(url),
      method: String(init?.method),
      authorization: headers['authorization'] ?? '',
    });
    if (String(url).endsWith('/installation')) {
      return options.installed === false
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify({ id: 77 }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        token: INSTALLATION_TOKEN,
        expires_at: options.expiresAt ?? '2026-11-11T13:00:00Z',
      }),
      { status: 201 },
    );
  });
  return { calls, fetch: fetchImpl as unknown as typeof fetch };
}

describe('appJwt', () => {
  it('is an RS256 token GitHub can verify with the app’s public key, for under ten minutes', () => {
    const jwt = appJwt('12345', PEM, NOW);
    const [header, payload, signature] = jwt.split('.') as [string, string, string];
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      number | string
    >;
    const issued = NOW.getTime() / 1000 - 60;
    expect(claims).toEqual({ iat: issued, exp: issued + 600, iss: '12345' });
  });
});

describe('GitHub App installation tokens', () => {
  it('asks which installation covers the repository, and exchanges the app token for its token', async () => {
    const { vault } = await setup();
    await storeGitHubApp(vault, { appId: '12345', privateKey: PEM });
    const remote = github();
    const tokens = createGitHubAppTokens({ vault, fetch: remote.fetch, now: () => NOW });
    expect(await tokens.tokenFor({ owner: 'acme', repo: 'shop' })).toBe(INSTALLATION_TOKEN);
    expect(remote.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://api.github.com/repos/acme/shop/installation',
      'POST https://api.github.com/app/installations/77/access_tokens',
    ]);
    for (const call of remote.calls)
      expect(call.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/u);
  });

  it('keeps the token until five minutes before it expires, then asks again', async () => {
    const { vault } = await setup();
    await storeGitHubApp(vault, { appId: '12345', privateKey: PEM });
    const remote = github();
    let clock = NOW;
    const tokens = createGitHubAppTokens({ vault, fetch: remote.fetch, now: () => clock });
    await tokens.tokenFor({ owner: 'acme', repo: 'shop' });
    clock = new Date('2026-11-11T12:54:00.000Z');
    await tokens.tokenFor({ owner: 'ACME', repo: 'Shop' });
    expect(remote.calls).toHaveLength(2);
    clock = new Date('2026-11-11T12:56:00.000Z');
    await tokens.tokenFor({ owner: 'acme', repo: 'shop' });
    expect(remote.calls).toHaveLength(4);
  });

  it('has no token with no app, or for a repository the app is not installed on', async () => {
    const { vault } = await setup();
    const remote = github({ installed: false });
    const tokens = createGitHubAppTokens({ vault, fetch: remote.fetch, now: () => NOW });
    expect(await tokens.tokenFor({ owner: 'acme', repo: 'shop' })).toBeNull();
    expect(remote.calls).toHaveLength(0);
    await storeGitHubApp(vault, { appId: '12345', privateKey: PEM });
    expect(await tokens.tokenFor({ owner: 'acme', repo: 'shop' })).toBeNull();
    expect(remote.calls).toHaveLength(1);
  });

  it('talks to a GitHub Enterprise Server when one is named', async () => {
    const { vault } = await setup();
    await storeGitHubApp(vault, { appId: '1', privateKey: PEM });
    const remote = github();
    await createGitHubAppTokens({
      vault,
      fetch: remote.fetch,
      apiBase: 'https://ghe.acme.test/api/v3/',
      now: () => NOW,
    }).tokenFor({ owner: 'a', repo: 'b' });
    expect(remote.calls[0]?.url).toBe('https://ghe.acme.test/api/v3/repos/a/b/installation');
  });

  it('says why there is no token, instead of reading as an app that is not set (MNT-172)', async () => {
    const { vault } = await setup();
    await storeGitHubApp(vault, { appId: '12345', privateKey: PEM });
    const log = vi.fn();
    const refused = createGitHubAppTokens({
      vault,
      fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
      now: () => NOW,
      log,
    });
    expect(await refused.tokenFor({ owner: 'acme', repo: 'shop' })).toBeNull();
    expect(log).toHaveBeenCalledWith('github app: GitHub refused the request', {
      step: 'installation',
      status: 401,
    });

    const unreachable = createGitHubAppTokens({
      vault,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
      now: () => NOW,
      log,
    });
    expect(await unreachable.tokenFor({ owner: 'acme', repo: 'shop' })).toBeNull();
    expect(log).toHaveBeenCalledWith('github app: GitHub could not be reached', {
      step: 'installation',
      error: 'TypeError',
    });
  });

  it('answers a stored entry it cannot read as corrupt, without throwing', async () => {
    const { vault } = await setup();
    await storeVaultSecret(vault, 'github-app', 'not json', 'A GitHub App key');
    const log = vi.fn();
    const tokens = createGitHubAppTokens({ vault, fetch: github().fetch, now: () => NOW, log });
    await expect(tokens.tokenFor({ owner: 'acme', repo: 'shop' })).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith('github app: the stored app is unreadable', {
      reason: 'not the shape saved from Settings',
    });
  });
});

describe('storing the app', () => {
  it('refuses a key that is not a private key, and stores and removes a real one', async () => {
    const { vault } = await setup();
    await expect(
      storeGitHubApp(vault, {
        appId: '1',
        // A key-shaped block that is not a key, assembled so no PEM header sits in the tree.
        privateKey: [
          `-----BEGIN PRIVATE `,
          `KEY-----\n${'x'.repeat(200)}\n-----END PRIVATE `,
          'KEY-----',
        ].join(''),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_BODY' });
    expect(await hasGitHubApp(vault)).toBe(false);
    await storeGitHubApp(vault, { appId: '1', privateKey: PEM });
    expect(await hasGitHubApp(vault)).toBe(true);
    await deleteGitHubApp(vault);
    expect(await hasGitHubApp(vault)).toBe(false);
  });

  it('keeps one workspace’s app out of another’s', async () => {
    const { vault } = await setup();
    await storeGitHubApp(vault, { appId: '1', privateKey: PEM });
    const other = { ...vault, workspaceId: 'ws-2' };
    expect(await hasGitHubApp(other)).toBe(false);
    const remote = github();
    expect(
      await createGitHubAppTokens({ vault: other, fetch: remote.fetch, now: () => NOW }).tokenFor({
        owner: 'a',
        repo: 'b',
      }),
    ).toBeNull();
    expect(remote.calls).toHaveLength(0);
  });
});
