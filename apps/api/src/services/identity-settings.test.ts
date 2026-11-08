import { describe, expect, it } from 'vitest';
import {
  createIdentityDrafts,
  lockoutProblem,
  oidcConfigFrom,
  roleUnderDraft,
  validateIdentityValues,
} from './identity-settings.js';

const PUBLIC = 'https://lupin.acme.test';
const SECRET = ['client', '-secret-', 'value'].join('');

const oidc = {
  'identity.oidcIssuer': 'https://acme.okta.test',
  'identity.oidcClientId': 'lupin',
  'identity.oidcClientSecret': SECRET,
  'identity.oidcRoleMap': 'admin:alice@acme.test, viewer:group:eng',
  'identity.oidcDefaultRole': 'none',
};

describe('identity settings', () => {
  it('builds the OIDC configuration the sign-in routes read, or none when it is off', () => {
    expect(oidcConfigFrom({}, PUBLIC)).toBeUndefined();
    expect(oidcConfigFrom(oidc, PUBLIC)).toMatchObject({
      issuer: 'https://acme.okta.test',
      clientId: 'lupin',
      redirectUri: 'https://lupin.acme.test/api/v1/auth/oidc/callback',
      defaultRole: null,
      roleMap: [
        { role: 'admin', kind: 'email', value: 'alice@acme.test' },
        { role: 'viewer', kind: 'group', value: 'eng' },
      ],
    });
  });

  it('refuses a client id without a secret, naming the fix', () => {
    expect(() =>
      oidcConfigFrom({ ...oidc, 'identity.oidcClientSecret': undefined }, PUBLIC),
    ).toThrow(/client secret/u);
  });

  it('validates every value with the registry schema and the real role-map parser', () => {
    expect(validateIdentityValues({ 'identity.oidcRoleMap': 'boss:alice' })).toMatchObject({
      'identity.oidcRoleMap': expect.stringContaining('role:who'),
    });
    expect(validateIdentityValues({ 'identity.oidcIssuer': 'http://okta.test' })).toHaveProperty(
      'identity.oidcIssuer',
    );
    expect(validateIdentityValues({ 'identity.oidcGarbage': 'x' })).toHaveProperty(
      'identity.oidcGarbage',
    );
    expect(validateIdentityValues(oidc)).toEqual({});
  });

  it('maps a signed-in identity to its role under the draft rules', () => {
    const config = oidcConfigFrom(oidc, PUBLIC);
    expect(roleUnderDraft(config, { email: 'alice@acme.test', groups: [] })).toBe('admin');
    expect(roleUnderDraft(config, { email: 'bob@acme.test', groups: ['eng'] })).toBe('viewer');
    expect(roleUnderDraft(config, { email: 'eve@acme.test', groups: [] })).toBeNull();
  });

  it('refuses a change that would leave nobody able to sign in as an admin', () => {
    // The admin's own group maps to viewer.
    expect(
      lockoutProblem({
        oidcChanged: true,
        cloudflareChanged: false,
        ssoEnforced: false,
        breakGlass: false,
        callerSource: 'installation',
        verified: { email: 'bob@acme.test', groups: ['eng'], role: 'viewer' },
      }),
    ).toMatchObject({
      code: 'WOULD_LOCK_OUT',
      message: expect.stringContaining('`eng` maps to viewer'),
    });
    // Single sign-on on, no break-glass, and no admin verified through it.
    expect(
      lockoutProblem({
        oidcChanged: true,
        cloudflareChanged: false,
        ssoEnforced: true,
        breakGlass: false,
        callerSource: 'installation',
        verified: null,
      }),
    ).toMatchObject({ code: 'NOT_VERIFIED' });
  });

  it('requires a test sign-in for any OIDC change, and the installation key for a Cloudflare one', () => {
    const base = { ssoEnforced: false, breakGlass: false, verified: null } as const;
    expect(
      lockoutProblem({
        ...base,
        oidcChanged: true,
        cloudflareChanged: false,
        callerSource: 'installation',
      }),
    ).toMatchObject({
      code: 'NOT_VERIFIED',
    });
    expect(
      lockoutProblem({
        ...base,
        oidcChanged: false,
        cloudflareChanged: true,
        callerSource: 'cloudflare',
      }),
    ).toMatchObject({
      code: 'NOT_VERIFIED',
      fix: expect.stringContaining('installation key'),
    });
    expect(
      lockoutProblem({
        ...base,
        oidcChanged: false,
        cloudflareChanged: true,
        callerSource: 'installation',
      }),
    ).toBeNull();
  });

  it('accepts a verified admin, with or without single sign-on enforced', () => {
    const verified = { email: 'alice@acme.test', groups: [], role: 'admin' as const };
    for (const ssoEnforced of [false, true]) {
      expect(
        lockoutProblem({
          oidcChanged: true,
          cloudflareChanged: false,
          ssoEnforced,
          breakGlass: false,
          callerSource: 'installation',
          verified,
        }),
      ).toBeNull();
    }
  });

  it('keeps a draft for ten minutes, and records its test sign-in', () => {
    let now = 0;
    const drafts = createIdentityDrafts(() => now);
    const draft = drafts.create({ 'identity.oidcRoleMap': 'admin:alice@acme.test' }, 'session');
    expect(drafts.get(draft.id)?.verified).toBeNull();
    drafts.verify(draft.id, { email: 'alice@acme.test', groups: [], role: 'admin' });
    expect(drafts.get(draft.id)?.verified?.role).toBe('admin');
    now = 11 * 60_000;
    expect(drafts.get(draft.id)).toBeUndefined();
  });

  it('forgets a verification when the draft is replaced', () => {
    const drafts = createIdentityDrafts(() => 0);
    const first = drafts.create({ 'identity.oidcRoleMap': 'admin:a@x.test' }, 'session');
    drafts.verify(first.id, { email: 'a@x.test', groups: [], role: 'admin' });
    const second = drafts.create({ 'identity.oidcRoleMap': 'viewer:a@x.test' }, 'session');
    expect(drafts.get(second.id)?.verified).toBeNull();
    expect(drafts.get(first.id)).toBeUndefined();
  });
});
