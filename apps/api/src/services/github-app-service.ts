import { createPrivateKey, createSign } from 'node:crypto';
import { z } from 'zod/v4';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import {
  deleteVaultSecret,
  hasVaultSecret,
  readVaultSecret,
  storeVaultSecret,
  type VaultOptions,
} from './vault-secrets.js';

/**
 * A GitHub App, so the server posts statuses, check runs and comments as the app rather than as
 * whoever owns a personal token, with a token that lasts an hour and reaches only the
 * repositories the app was installed on.
 *
 * The app's id and private key are one vault entry per workspace (`github-app`), sealed like
 * every credential and never returned. To act on a repository the server signs a ten-minute app
 * token (RS256, `node:crypto`), asks GitHub which installation covers the repository, and
 * exchanges the app token for that installation's token, which it keeps in memory until five
 * minutes before GitHub says it expires. A project's own token, when it has one, still wins:
 * it was set for that project on purpose.
 *
 * Nothing here throws for GitHub's refusal: a repository the app is not installed on, or a key
 * GitHub no longer accepts, is "no token", and the gate's verdict is returned without a post.
 */

const ENTRY = 'github-app';
const WHAT = 'A GitHub App key';
const APP_TOKEN_SECONDS = 9 * 60;
const CLOCK_SKEW_SECONDS = 60;
const REFRESH_BEFORE_MS = 5 * 60_000;

export const GitHubAppBodySchema = z.object({
  appId: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/u, 'The App ID is the number on the app’s page'),
  privateKey: z
    .string()
    .trim()
    .min(100)
    .max(10_000)
    .refine((key) => key.includes('PRIVATE KEY-----'), 'Paste the .pem file GitHub generated'),
});
export type GitHubAppBody = z.infer<typeof GitHubAppBodySchema>;

const StoredSchema = z.object({ appId: z.string(), privateKey: z.string() });

export async function storeGitHubApp(options: VaultOptions, body: GitHubAppBody): Promise<void> {
  try {
    createPrivateKey(body.privateKey);
  } catch {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      'That is not a private key GitHub issued',
      {
        details: {
          fix: 'Generate a private key on the app’s settings page and paste the .pem file.',
        },
      },
    );
  }
  await storeVaultSecret(options, ENTRY, JSON.stringify(body), WHAT);
}

export async function hasGitHubApp(options: VaultOptions): Promise<boolean> {
  return hasVaultSecret(options, ENTRY);
}

export async function deleteGitHubApp(options: VaultOptions): Promise<void> {
  await deleteVaultSecret(options, ENTRY);
}

const base64url = (value: Buffer | string) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/=+$/u, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_');

/** The app's own token: RS256, issued a minute back for clock skew, good for nine minutes. */
export function appJwt(appId: string, privateKey: string, now: Date): string {
  const issued = Math.floor(now.getTime() / 1000) - CLOCK_SKEW_SECONDS;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: issued,
      exp: issued + CLOCK_SKEW_SECONDS + APP_TOKEN_SECONDS,
      iss: appId,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
}

export interface GitHubAppTokens {
  /** An installation token for `owner/repo`, or `null` when the app cannot act there. */
  tokenFor(repository: { owner: string; repo: string }): Promise<string | null>;
}

const InstallationSchema = z.object({ id: z.number().int().positive() });
const AccessTokenSchema = z.object({ token: z.string().min(1), expires_at: z.string() });

export function createGitHubAppTokens(deps: {
  vault: VaultOptions;
  fetch?: typeof fetch;
  /** GitHub's API, `https://api.github.com` unless a GitHub Enterprise Server is named. */
  apiBase?: string | undefined;
  now?: () => Date;
}): GitHubAppTokens {
  const fetchImpl = deps.fetch ?? fetch;
  const now = () => deps.now?.() ?? new Date();
  const api = (deps.apiBase ?? 'https://api.github.com').replace(/\/+$/u, '');
  const cache = new Map<string, { token: string; until: number }>();

  async function ask(path: string, method: 'GET' | 'POST', jwt: string): Promise<unknown> {
    try {
      const response = await fetchImpl(`${api}${path}`, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      });
      return response.ok ? ((await response.json()) as unknown) : null;
    } catch {
      return null;
    }
  }

  return {
    async tokenFor({ owner, repo }) {
      const key = `${owner}/${repo}`.toLowerCase();
      const cached = cache.get(key);
      if (cached !== undefined && cached.until > now().getTime()) return cached.token;
      const raw = await readVaultSecret(deps.vault, ENTRY, WHAT).catch(() => null);
      const stored = raw === null ? null : StoredSchema.safeParse(JSON.parse(raw) as unknown);
      if (stored === null || !stored.success) return null;
      const jwt = appJwt(stored.data.appId, stored.data.privateKey, now());
      const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`;
      const installation = InstallationSchema.safeParse(await ask(path, 'GET', jwt));
      if (!installation.success) return null;
      const granted = AccessTokenSchema.safeParse(
        await ask(`/app/installations/${String(installation.data.id)}/access_tokens`, 'POST', jwt),
      );
      if (!granted.success) return null;
      const expires = Date.parse(granted.data.expires_at);
      if (!Number.isNaN(expires)) {
        cache.set(key, { token: granted.data.token, until: expires - REFRESH_BEFORE_MS });
      }
      return granted.data.token;
    },
  };
}
