import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isAddressAllowed, parseCidr } from '@lupin/config';
import { DomainError, ErrorCode } from '../errors/domain-error.js';

/**
 * The one check every admin-configured URL goes through before the server calls it (plan
 * task 9): webhooks, notification channels and their bridges, the issue tracker, the OIDC
 * issuer and the Ollama base URL.
 *
 * The server makes the request, so a URL an admin types is a request the server makes on their
 * behalf. Pointing one at the cloud metadata service or at a database on the server's own
 * network is the attack, so a URL is refused when **any** address its host resolves to is
 * loopback, private, link-local (which holds the metadata service), carrier-grade NAT,
 * unique-local or unspecified. Resolving, rather than reading a literal, is what catches a
 * public name that points inward.
 *
 * A LAN install that needs one (a Signal bridge on the same machine, Ollama on the LAN) names
 * it in `LUPIN_OUTBOUND_ALLOW`: hostnames and ranges, comma-separated. Nothing is allowed by
 * default.
 *
 * What it does not cover: a name that resolves to a public address here and a private one at
 * request time (DNS rebinding). The window is the time between this check and the request;
 * closing it means pinning the address into the request, which `fetch` does not offer.
 */
export const BLOCKED_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
] as const;

export interface OutboundAllowlist {
  hosts: readonly string[];
  ranges: readonly string[];
}

export const NO_ALLOWLIST: OutboundAllowlist = { hosts: [], ranges: [] };

/** `LUPIN_OUTBOUND_ALLOW`, parsed: each entry is a range if it parses as one, else a hostname. */
export function outboundAllowlistFrom(value: string | undefined): OutboundAllowlist {
  const hosts: string[] = [];
  const ranges: string[] = [];
  for (const entry of (value ?? '').split(',').map((part) => part.trim().toLowerCase())) {
    if (entry === '') continue;
    const address = entry.split('/')[0] ?? '';
    if (isIP(address) !== 0) {
      parseCidr(entry);
      ranges.push(entry);
    } else if (/^[a-z0-9.-]+$/u.test(entry)) {
      hosts.push(entry);
    } else {
      throw new Error(`LUPIN_OUTBOUND_ALLOW: "${entry}" is neither a hostname nor an IP range`);
    }
  }
  return { hosts, ranges };
}

export type Resolve = (host: string) => Promise<string[]>;

/**
 * `::ffff:7f00:1` as `::ffff:127.0.0.1`. `new URL` writes an IPv4-mapped address in hex, and
 * the range check only unmaps the dotted form, so a mapped loopback would otherwise pass.
 */
function dottedMapped(address: string): string {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(address);
  if (match === null) return address;
  const high = Number.parseInt(match[1] ?? '0', 16);
  const low = Number.parseInt(match[2] ?? '0', 16);
  return `::ffff:${String(high >> 8)}.${String(high & 255)}.${String(low >> 8)}.${String(low & 255)}`;
}

const systemResolver: Resolve = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

let resolveAll: Resolve = systemResolver;

/**
 * Replaces how hostnames are resolved, or restores the system resolver with no argument. For
 * the test suite, which must not depend on the network's DNS.
 */
export function useOutboundResolver(resolve: Resolve = systemResolver): void {
  resolveAll = resolve;
}

/** The addresses `host` stands for, or `null` when it resolves to none. */
async function addressesOf(host: string, resolve: Resolve): Promise<string[] | null> {
  if (isIP(host) !== 0) return [host];
  try {
    const addresses = await resolve(host);
    return addresses.length === 0 ? null : addresses;
  } catch {
    return null;
  }
}

/** The first address the server must not call, or `undefined`. */
function blockedAmong(addresses: readonly string[], allow: OutboundAllowlist): string | undefined {
  return addresses
    .map(dottedMapped)
    .find(
      (address) =>
        !isAddressAllowed(address, allow.ranges) && isAddressAllowed(address, BLOCKED_RANGES),
    );
}

/**
 * Why the server must not call `url`, or `null` when it may.
 *
 * @param protocols the schemes this kind of URL may use; `https:` unless the caller says so
 */
export async function outboundProblem(
  url: string,
  options: {
    allow: OutboundAllowlist;
    protocols?: readonly string[];
    resolve?: Resolve;
  },
): Promise<string | null> {
  if (!URL.canParse(url)) return 'is not a URL';
  const parsed = new URL(url);
  const protocols = options.protocols ?? ['https:'];
  if (!protocols.includes(parsed.protocol)) return `must use ${protocols.join(' or ')}`;
  if (parsed.username !== '' || parsed.password !== '') return 'must not carry credentials';
  const host = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (options.allow.hosts.includes(host)) return null;
  const addresses = await addressesOf(host, options.resolve ?? resolveAll);
  if (addresses === null) return `names a host that does not resolve (${host})`;
  const blocked = blockedAmong(addresses, options.allow);
  return blocked === undefined
    ? null
    : `points at ${blocked}, a private, loopback or link-local address. ` +
        'If this install needs it, add the host to LUPIN_OUTBOUND_ALLOW';
}

/** The allowlist as the environment sets it now. Read per call, so a test can set it. */
export function currentOutboundAllowlist(): OutboundAllowlist {
  return outboundAllowlistFrom(process.env['LUPIN_OUTBOUND_ALLOW']);
}

/**
 * Throws a `DomainError` naming `what` when the server must not call `url`.
 *
 * @param what the setting, as a person reads it: "The Teams webhook", "The issuer"
 */
export async function assertOutboundUrl(
  url: string,
  what: string,
  options: { protocols?: readonly string[]; resolve?: Resolve } = {},
): Promise<void> {
  const problem = await outboundProblem(url, { ...options, allow: currentOutboundAllowlist() });
  if (problem !== null) {
    throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, `${what} ${problem}`);
  }
}
