import { afterEach, describe, expect, it } from 'vitest';
import {
  NO_ALLOWLIST,
  assertOutboundUrl,
  outboundAllowlistFrom,
  outboundProblem,
  type Resolve,
} from './outbound-guard.js';

/** Plan task 9: one check for every URL an admin gives the server to call. */
const to =
  (...addresses: string[]): Resolve =>
  async () =>
    addresses;

describe('outboundProblem', () => {
  it.each([
    'https://127.0.0.1/hook',
    'https://10.1.2.3/hook',
    'https://172.20.0.1/hook',
    'https://192.168.1.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/hook',
    'https://0.0.0.0/hook',
    'https://[::1]/hook',
    'https://[fd00:ec2::254]/hook',
    'https://[fe80::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
  ])('refuses the literal %s', async (url) => {
    expect(await outboundProblem(url, { allow: NO_ALLOWLIST })).toMatch(/LUPIN_OUTBOUND_ALLOW/);
  });

  it('refuses a public name that resolves inward, on any one of its addresses', async () => {
    const problem = await outboundProblem('https://hooks.example.com/x', {
      allow: NO_ALLOWLIST,
      resolve: to('203.0.113.5', '169.254.169.254'),
    });
    expect(problem).toMatch(/169\.254\.169\.254/);
  });

  it('allows a public address, and refuses what does not resolve', async () => {
    expect(
      await outboundProblem('https://hooks.example.com/x', {
        allow: NO_ALLOWLIST,
        resolve: to('203.0.113.5'),
      }),
    ).toBeNull();
    expect(
      await outboundProblem('https://nowhere.example/x', {
        allow: NO_ALLOWLIST,
        resolve: () => Promise.reject(new Error('ENOTFOUND')),
      }),
    ).toMatch(/does not resolve/);
    expect(
      await outboundProblem('https://empty.example/x', { allow: NO_ALLOWLIST, resolve: to() }),
    ).toMatch(/does not resolve/);
  });

  it('refuses a wrong scheme, credentials, and a non-URL', async () => {
    expect(await outboundProblem('http://example.com', { allow: NO_ALLOWLIST })).toMatch(/https/);
    expect(
      await outboundProblem('https://u:p@example.com', { allow: NO_ALLOWLIST, resolve: to() }),
    ).toMatch(/credentials/);
    expect(await outboundProblem('not a url', { allow: NO_ALLOWLIST })).toBe('is not a URL');
  });

  it('lets an allowlisted host or range through', async () => {
    const allow = outboundAllowlistFrom('signal.lan, 192.168.1.0/24');
    expect(
      await outboundProblem('http://signal.lan:8080', {
        allow,
        protocols: ['http:'],
        resolve: to('10.0.0.9'),
      }),
    ).toBeNull();
    expect(await outboundProblem('https://192.168.1.20/x', { allow })).toBeNull();
    expect(await outboundProblem('https://192.168.2.20/x', { allow })).not.toBeNull();
  });
});

describe('outboundAllowlistFrom', () => {
  it('splits hosts from ranges, and refuses nonsense', () => {
    expect(outboundAllowlistFrom(undefined)).toEqual(NO_ALLOWLIST);
    expect(outboundAllowlistFrom(' Bridge.LAN ,10.0.0.0/8,127.0.0.1 ')).toEqual({
      hosts: ['bridge.lan'],
      ranges: ['10.0.0.0/8', '127.0.0.1'],
    });
    expect(() => outboundAllowlistFrom('10.0.0.0/99')).toThrow(/prefix/);
    expect(() => outboundAllowlistFrom('a b')).toThrow(/LUPIN_OUTBOUND_ALLOW/);
  });
});

describe('assertOutboundUrl', () => {
  afterEach(() => {
    delete process.env['LUPIN_OUTBOUND_ALLOW'];
  });

  it('names the setting, and reads the allowlist from the environment', async () => {
    await expect(assertOutboundUrl('https://127.0.0.1/x', 'The webhook')).rejects.toMatchObject({
      code: 'INVALID_REQUEST_BODY',
      message: expect.stringMatching(/^The webhook points at 127\.0\.0\.1/),
    });
    process.env['LUPIN_OUTBOUND_ALLOW'] = '127.0.0.1';
    await expect(assertOutboundUrl('https://127.0.0.1/x', 'The webhook')).resolves.toBeUndefined();
  });
});
