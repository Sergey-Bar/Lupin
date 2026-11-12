import { describe, expect, it } from 'vitest';
import { hashCredential } from '@lupin/auth';
import { discoveryKey, openFlow, rememberDiscovery } from './oidc.js';

/**
 * The OIDC discovery cache and the sign-in flow cookie (ledger MNT-174). The cache kept every
 * tested identity draft for the life of the process, keyed by the plaintext client secret;
 * the flow cookie was cast to its type once its signature checked out.
 */
const SECRET = ['flow', 'secret', 'for', 'tests'].join('-');

function seal(flow: unknown): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${payload}.${hashCredential(SECRET, `oidc:${payload}`)}`;
}

describe('the discovery cache', () => {
  it('keys a configuration without holding its client secret', () => {
    const clientSecret = ['very', 'secret', 'value'].join('-');
    const key = discoveryKey({ issuer: 'https://id.example', clientId: 'lupin', clientSecret });
    expect(key).not.toContain(clientSecret);
    expect(key).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      discoveryKey({ issuer: 'https://id.example', clientId: 'lupin', clientSecret: 'other' }),
    ).not.toBe(key);
  });

  it('keeps at most a bounded number of configurations, dropping the oldest', () => {
    const cache = new Map<string, number>();
    for (let index = 0; index < 20; index += 1) rememberDiscovery(cache, `k${index}`, index, 8);
    expect(cache.size).toBe(8);
    expect([...cache.keys()][0]).toBe('k12');
  });
});

describe('the sign-in flow cookie', () => {
  const NOW = 1_000;
  it('opens a whole, current flow', () => {
    const flow = { state: 's', nonce: 'n', verifier: 'v', expiresAt: NOW + 1 };
    expect(openFlow(SECRET, seal(flow), NOW)).toEqual(flow);
  });

  it('refuses a signed flow that is missing a part, rather than casting it', () => {
    expect(openFlow(SECRET, seal({ state: 's', expiresAt: NOW + 1 }), NOW)).toBeNull();
    expect(
      openFlow(SECRET, seal({ state: 's', nonce: 'n', verifier: 'v', expiresAt: 'later' }), NOW),
    ).toBeNull();
    expect(
      openFlow(SECRET, seal({ state: 's', nonce: 'n', verifier: 'v', expiresAt: NOW - 1 }), NOW),
    ).toBeNull();
  });
});
