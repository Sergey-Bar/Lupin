import { describe, expect, it } from 'vitest';
import { publicLink } from './public-link.js';

describe('publicLink', () => {
  it('joins the public address and the path, once', () => {
    expect(publicLink('https://lupin.example.com', '/dashboard/now')).toBe(
      'https://lupin.example.com/dashboard/now',
    );
    expect(publicLink('https://lupin.example.com/', '/dashboard/now')).toBe(
      'https://lupin.example.com/dashboard/now',
    );
  });

  it('keeps a path prefix the install is served under', () => {
    expect(publicLink('https://example.com/lupin/', '/dashboard/now')).toBe(
      'https://example.com/lupin/dashboard/now',
    );
  });

  it('gives no link for an address nobody else can open', () => {
    for (const address of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
      'http://app.localhost:5173',
      'http://0.0.0.0:5173',
      'http://localhost.:5173',
      'http://127.1.2.3:5173',
      'http://[::ffff:127.0.0.1]:5173',
    ]) {
      expect(publicLink(address, '/dashboard/now')).toBeNull();
    }
  });

  it('gives no link for an address that is missing, malformed or not http(s)', () => {
    expect(publicLink(undefined, '/dashboard/now')).toBeNull();
    expect(publicLink('', '/dashboard/now')).toBeNull();
    expect(publicLink('not a url', '/dashboard/now')).toBeNull();
    expect(publicLink('javascript:alert(1)', '/dashboard/now')).toBeNull();
  });

  it('does not mistake a public name that starts with 127. for loopback', () => {
    expect(publicLink('https://127.example.com', '/dashboard/now')).toBe(
      'https://127.example.com/dashboard/now',
    );
  });

  it('does not treat a LAN address as loopback', () => {
    expect(publicLink('http://192.168.1.20:5173', '/dashboard/now')).toBe(
      'http://192.168.1.20:5173/dashboard/now',
    );
  });
});
