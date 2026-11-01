import { isIP } from 'node:net';
import { usage } from './errors.js';

/**
 * Where the CLI talks to, and with what. Read from the environment so a token never appears
 * in a command line, a shell history or a process listing:
 *
 * - `LUPIN_URL` — the install's origin. `https://` anywhere; `http://` only to a loopback
 *   host (`localhost`, `127.0.0.0/8`, `::1`), because the token would cross the network in
 *   the clear.
 * - `LUPIN_TOKEN` — an `lup_` access token: `uploader` pinned to the project for CI.
 * - `LUPIN_PROJECT` — the project id, unless `--project` names it.
 * - `LUPIN_CF_ACCESS_CLIENT_ID` and `LUPIN_CF_ACCESS_CLIENT_SECRET` — a Cloudflare
 *   Access service token, for an install reached through a tunnel (ADR-014). Both or neither:
 *   Access lets the request through, and the access token still decides what it may do.
 */
export interface Target {
  origin: URL;
  token: string;
  project: string;
  cloudflareAccess?: { clientId: string; clientSecret: string };
}

/**
 * Whether a host keeps the request on this machine.
 *
 * The same answer as `isLoopbackBind` (`@lupin/config`), which the MCP stdio proxy uses:
 * `localhost`, `127.0.0.0/8` (also as an IPv4-mapped `::ffff:127.x.x.x`), and `::1` in any
 * spelling. The CLI ships with no runtime dependency, so it cannot import that function;
 * `units.test.ts` holds the two to the same answer over a table of hosts instead.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .replace(/^\[|\]$/gu, '')
    .toLowerCase();
  if (host === 'localhost') return true;
  const plain = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(host)?.[1] ?? host;
  if (isIP(plain) === 4) return plain.split('.')[0] === '127';
  // The WHATWG parser writes every spelling of an IPv6 address one way.
  return isIP(plain) === 6 && new URL(`http://[${plain}]/`).hostname === '[::1]';
}

const PROJECT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function resolveTarget(
  env: Readonly<Record<string, string | undefined>>,
  projectFlag: string | undefined,
): Target {
  const raw = env['LUPIN_URL']?.trim() ?? '';
  const token = env['LUPIN_TOKEN']?.trim() ?? '';
  const project = (projectFlag ?? env['LUPIN_PROJECT'] ?? '').trim();
  if (raw === '') throw usage('Set LUPIN_URL to the Lupin origin, e.g. https://lupin.example.com');
  if (!token.startsWith('lup_')) throw usage('Set LUPIN_TOKEN to an lup_ access token.');
  if (!PROJECT.test(project)) {
    throw usage('Name the project: --project <id> or LUPIN_PROJECT, its id from the dashboard.');
  }
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    throw usage(`LUPIN_URL is not a URL: ${raw}`);
  }
  if (origin.username !== '' || origin.password !== '') {
    throw usage('LUPIN_URL must not carry credentials; the token goes in LUPIN_TOKEN.');
  }
  const plainAllowed = origin.protocol === 'http:' && isLoopbackHost(origin.hostname);
  if (origin.protocol !== 'https:' && !plainAllowed) {
    throw usage(
      `Refusing ${origin.protocol}//${origin.host}: use https://, or http:// only to a loopback host, because the token would cross the network in the clear.`,
    );
  }
  const clientId = env['LUPIN_CF_ACCESS_CLIENT_ID']?.trim() ?? '';
  const clientSecret = env['LUPIN_CF_ACCESS_CLIENT_SECRET']?.trim() ?? '';
  if ((clientId === '') !== (clientSecret === '')) {
    throw usage(
      `A Cloudflare Access service token has two halves; set ${
        clientId === '' ? 'LUPIN_CF_ACCESS_CLIENT_ID' : 'LUPIN_CF_ACCESS_CLIENT_SECRET'
      } too, or neither.`,
    );
  }
  return clientId === ''
    ? { origin, token, project }
    : { origin, token, project, cloudflareAccess: { clientId, clientSecret } };
}

/** `/api/v1/projects/<id><suffix>`, with the id encoded. */
export function projectUrl(
  target: Target,
  suffix: string,
  query: Record<string, string | undefined> = {},
): URL {
  const url = new URL(
    `/api/v1/projects/${encodeURIComponent(target.project)}${suffix}`,
    target.origin,
  );
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  return url;
}
