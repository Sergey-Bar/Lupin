/**
 * A link into the web app for a message that leaves the machine (a Slack, Teams or Telegram
 * report), or `null` when there is no address a recipient could open.
 *
 * `PUBLIC_APP_URL` defaults to `http://localhost:5173`, which is right for the person running
 * the install and wrong for everyone they send a report to: the link would open their own
 * machine. So a loopback address, a missing one and anything that is not http(s) give no link,
 * and the report goes without one rather than with a link that cannot work. Setting
 * `PUBLIC_APP_URL` to the address people actually use (the tunnel hostname, the LAN name) is
 * what turns the link on.
 */
/** 127.a.b.c with four numeric parts; a name such as 127.example.com is not loopback. */
function isLoopbackV4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/u.test(part));
}

export function publicLink(publicAppUrl: string | undefined, path: string): string | null {
  if (publicAppUrl === undefined || publicAppUrl === '') return null;
  let url: URL;
  try {
    url = new URL(publicAppUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
    .toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    isLoopbackV4(host) ||
    host.startsWith('::ffff:7f')
  ) {
    return null;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}${path}`;
}
