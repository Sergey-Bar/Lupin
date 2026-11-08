import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import * as client from 'openid-client';
import type { OidcConfig } from '@lupin/config';
import { hashCredential, verifyCredential } from '@lupin/auth';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { guard } from '../http/access.js';
import { isSecureFor, type SecureCookies } from '../http/secure-cookies.js';
import { ttlOf, type AuthSessionBackend } from '../infrastructure/session-backend.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { audit } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';
import { signInPerson } from '../services/user-service.js';
import { defaultClientKey } from './auth.js';

/**
 * OIDC sign-in (ADR-014, the team profile): the authorization code flow with PKCE, a state
 * and a nonce, through `openid-client`.
 *
 * - `GET /api/v1/auth/oidc/start` sends the browser to the provider. The PKCE verifier, the
 *   state and the nonce travel in a short-lived `httpOnly` cookie signed under
 *   `COOKIE_SECRET`, so nothing about a sign-in in progress is held in this process.
 * - `GET /api/v1/auth/oidc/callback` exchanges the code. `openid-client` checks the state, the
 *   nonce, the PKCE verifier and the ID token's signature, issuer, audience and expiry; this
 *   route then refuses an unverified email or one outside `OIDC_ALLOWED_DOMAINS`, signs the
 *   person in through `signInPerson`, and issues a session that names them.
 *
 * Both answer a coded 404 until OIDC is configured with a database, as the GitHub receiver
 * does, so an install that never opted in has nothing to probe. A failed start (the provider
 * cannot be discovered) or callback redirects to `/?signin=<reason>` rather than answering
 * JSON, because a browser is on the other end.
 */
export interface OidcRouteOptions extends Partial<Pick<ProjectRegistryServiceOptions, 'db'>> {
  /** The configuration, or a reader for the one in effect (Settings → Identity applies live). */
  oidc?: OidcConfig | (() => Promise<OidcConfig | undefined>);
  /**
   * The test sign-in behind Settings → Identity: a flow started with a draft configuration
   * comes back through the same registered callback, and is reported here instead of signing
   * anyone in.
   */
  test?: {
    /** The guard on the test-start route: refuses anyone who is not an installation admin. */
    authorize: MiddlewareHandler;
    configFor(draftId: string): Promise<OidcConfig | undefined>;
    onResult(
      draftId: string,
      identity: { email: string; groups: string[] } | null,
      reason?: string,
    ): Promise<void> | void;
  };
  workspaceId: string;
  sessions: AuthSessionBackend;
  installationId: string;
  cookieSecret: string;
  /** A number, or a reader so a lifetime saved from Settings applies to the next sign-in. */
  sessionTtlMs: number | (() => number);
  secureCookies: SecureCookies;
  trustProxy?: boolean;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

// The cookie holding a sign-in in progress, sealed. Named without `cookie`: the secret-literal
// rule reads that word in a name as a credential held in source.
const SIGN_IN_FLOW = 'lupin_oidc';
const SESSION_COOKIE = 'lupin_session';
/** A sign-in in progress outlives a slow provider page, not a lunch break. */
const FLOW_TTL_MS = 10 * 60_000;

interface Flow {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
  /** Set for a test sign-in from Settings → Identity: the draft being tested. */
  draft?: string;
}

function sealFlow(secret: string, flow: Flow): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${payload}.${hashCredential(secret, `oidc:${payload}`)}`;
}

function openFlow(secret: string, value: string | undefined, now: number): Flow | null {
  if (value === undefined) return null;
  const [payload, signature] = value.split('.');
  if (payload === undefined || signature === undefined) return null;
  if (!/^[0-9a-f]{64}$/u.test(signature)) return null;
  if (!verifyCredential(secret, `oidc:${payload}`, signature)) return null;
  try {
    const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Flow;
    return typeof flow.expiresAt === 'number' && flow.expiresAt > now ? flow : null;
  } catch {
    return null;
  }
}

function groupsOf(claims: Record<string, unknown>): string[] {
  const groups = claims['groups'];
  return Array.isArray(groups)
    ? groups.filter((group): group is string => typeof group === 'string')
    : [];
}

/**
 * Whether the provider says the email is not verified: `false`, or the string `"false"` some
 * providers send. An absent claim is accepted, because Entra omits it: the email is then the
 * one the provider asserts, which is the trust the guide states.
 */
function unverified(claim: unknown): boolean {
  return claim === false || (typeof claim === 'string' && claim.trim().toLowerCase() === 'false');
}

/**
 * The person the claims name, or why they are refused: no email or subject, an email the
 * provider says is unverified, or a domain outside the allowed list.
 */
function checkClaims(
  claims: Record<string, unknown>,
  allowedDomains: readonly string[],
):
  | { email: string; subject: string }
  | { refused: 'failed' | 'unverified' | 'domain'; fields?: Record<string, unknown> } {
  const email = typeof claims['email'] === 'string' ? claims['email'].toLowerCase() : '';
  const subject = typeof claims['sub'] === 'string' ? claims['sub'] : '';
  if (email === '' || subject === '') return { refused: 'failed' };
  if (unverified(claims['email_verified'])) return { refused: 'unverified' };
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
    return { refused: 'domain', fields: { domain } };
  }
  return { email, subject };
}

export function createOidcRoutes(options: OidcRouteOptions): Hono {
  const app = new Hono();
  const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
  const discovered = new Map<string, Promise<client.Configuration>>();

  const current = async (): Promise<OidcConfig | undefined> =>
    typeof options.oidc === 'function' ? options.oidc() : options.oidc;

  const configured = async (): Promise<{
    oidc: OidcConfig;
    db: NonNullable<OidcRouteOptions['db']>;
  }> => {
    const oidc = await current();
    if (oidc === undefined || options.db === undefined) {
      throw new DomainError(
        ErrorCode.OIDC_NOT_CONFIGURED,
        'Single sign-on is off: set the issuer and client id in Settings → Identity (or OIDC_ISSUER and OIDC_CLIENT_ID), with a database',
      );
    }
    return { oidc, db: options.db };
  };

  const throttle = (context: Context): void => {
    const budget = limiter.consume(
      `oidc:${defaultClientKey(context, options.trustProxy ?? false)}`,
    );
    if (!budget.allowed) {
      context.header('retry-after', String(budget.retryAfterSeconds));
      throw new DomainError('RATE_LIMITED', 'Too many sign-in attempts');
    }
  };

  /**
   * Discovery, once per provider configuration; a failure is forgotten so the next sign-in
   * tries again. Keyed by issuer, client and secret, so a configuration saved from Settings
   * (or a draft under test) never reuses another's.
   */
  const configuration = (oidc: OidcConfig): Promise<client.Configuration> => {
    const key = `${oidc.issuer}\u0000${oidc.clientId}\u0000${oidc.clientSecret}`;
    const cached = discovered.get(key);
    if (cached !== undefined) return cached;
    const pending = client
      .discovery(
        new URL(oidc.issuer),
        oidc.clientId,
        oidc.clientSecret,
        undefined,
        // The configuration refuses plain HTTP off this machine, so this is a local provider.
        oidc.issuer.startsWith('http:') ? { execute: [client.allowInsecureRequests] } : undefined,
      )
      .catch((error: unknown) => {
        discovered.delete(key);
        throw error;
      });
    discovered.set(key, pending);
    return pending;
  };

  const redirectWith = (context: Context, reason: string, fields: Record<string, unknown> = {}) => {
    options.log?.('single sign-on refused', { reason, ...fields });
    deleteCookie(context, SIGN_IN_FLOW, { path: '/api/v1/auth/oidc' });
    return context.redirect(`/?signin=${reason}`, 302);
  };

  /** Starts a sign-in with the provider; `draft` marks it as a test of that draft. */
  const begin = async (context: Context, oidc: OidcConfig, draft?: string) => {
    throttle(context);
    let config: client.Configuration;
    try {
      config = await configuration(oidc);
    } catch (error) {
      if (draft !== undefined) {
        await options.test?.onResult(draft, null, 'provider-unreachable');
        return context.redirect('/dashboard/settings/identity?test=unreachable', 302);
      }
      // The provider is down or misconfigured: back to the sign-in screen, as a failed
      // callback goes, rather than a 500 page in the middle of signing in.
      return redirectWith(context, 'failed', {
        error: error instanceof Error ? error.name : 'error',
      });
    }
    const flow: Flow = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      verifier: client.randomPKCECodeVerifier(),
      expiresAt: Date.now() + FLOW_TTL_MS,
      ...(draft === undefined ? {} : { draft }),
    };
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: oidc.redirectUri,
      scope: 'openid email profile',
      code_challenge: await client.calculatePKCECodeChallenge(flow.verifier),
      code_challenge_method: 'S256',
      state: flow.state,
      nonce: flow.nonce,
    });
    setCookie(context, SIGN_IN_FLOW, sealFlow(options.cookieSecret, flow), {
      httpOnly: true,
      // The provider sends the browser back with a top-level GET, which Lax allows.
      sameSite: 'Lax',
      secure: isSecureFor(options.secureCookies, context),
      path: '/api/v1/auth/oidc',
      maxAge: Math.floor(FLOW_TTL_MS / 1000),
    });
    return context.redirect(url.href, 302);
  };

  app.get('/api/v1/auth/oidc/start', async (context) => {
    const { oidc } = await configured();
    return begin(context, oidc);
  });

  if (options.test !== undefined) {
    const test = options.test;
    // Test sign-in for Settings → Identity. Admin, and the identity routes it is reached from
    // also require an installation admin; the flow it starts signs nobody in.
    app.get('/api/v1/auth/oidc/test', guard('admin', test.authorize), async (context) => {
      const draft = context.req.query('draft') ?? '';
      const oidc = await test.configFor(draft);
      if (oidc === undefined)
        return context.redirect('/dashboard/settings/identity?test=expired', 302);
      return begin(context, oidc, draft);
    });
  }

  /**
   * Exchanges the code the provider returned for its verified claims. `openid-client` checks
   * the state, the nonce, the PKCE verifier and the ID token. The URL is rebuilt on the
   * registered redirect URI: behind the edge, the request URL this process sees names the
   * proxy, not the public origin the provider redirected to.
   */
  const exchange = async (
    oidc: OidcConfig,
    flow: Flow,
    requestUrl: string,
  ): Promise<Record<string, unknown>> => {
    const returned = new URL(oidc.redirectUri);
    returned.search = new URL(requestUrl).search;
    const tokens = await client.authorizationCodeGrant(await configuration(oidc), returned, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    return (tokens.claims() ?? {}) as Record<string, unknown>;
  };

  /** The end of a test sign-in: who came back, reported to the draft; no session is issued. */
  const finishTest = async (context: Context, flow: Flow, draft: string) => {
    deleteCookie(context, SIGN_IN_FLOW, { path: '/api/v1/auth/oidc' });
    const back = (outcome: string) =>
      context.redirect(`/dashboard/settings/identity?test=${outcome}`, 302);
    const oidc = await options.test?.configFor(draft);
    if (oidc === undefined) return back('expired');
    try {
      const claims = await exchange(oidc, flow, context.req.url);
      // The same checks a real sign-in makes, so a draft whose rules would refuse this person
      // (an unverified email, a domain outside the allow-list) fails its test instead of
      // passing it and locking them out on apply.
      const checked = checkClaims(claims, oidc.allowedDomains);
      if ('refused' in checked) {
        await options.test?.onResult(draft, null, checked.refused);
        return back(checked.refused === 'domain' ? 'domain' : 'failed');
      }
      // Recorded before the browser is sent back, so the page reads the verdict, not a race.
      await options.test?.onResult(draft, { email: checked.email, groups: groupsOf(claims) });
      return back('done');
    } catch (error) {
      await options.test?.onResult(draft, null, error instanceof Error ? error.name : 'error');
      return back('failed');
    }
  };

  app.get('/api/v1/auth/oidc/callback', async (context) => {
    throttle(context);
    const flow = openFlow(options.cookieSecret, getCookie(context, SIGN_IN_FLOW), Date.now());
    // A test sign-in works before sign-in is switched on; everything else is a coded 404 until
    // it is, as before.
    if (flow?.draft !== undefined) return finishTest(context, flow, flow.draft);
    const { oidc, db } = await configured();
    if (flow === null) return redirectWith(context, 'expired');
    let claims: Record<string, unknown>;
    try {
      claims = await exchange(oidc, flow, context.req.url);
    } catch (error) {
      return redirectWith(context, 'failed', {
        error: error instanceof Error ? error.name : 'error',
      });
    }
    const checked = checkClaims(claims, oidc.allowedDomains);
    if ('refused' in checked) return redirectWith(context, checked.refused, checked.fields);
    const { email, subject } = checked;
    const scope = { db, workspaceId: options.workspaceId };
    const outcome = await signInPerson(
      scope,
      {
        issuer: oidc.issuer,
        subject,
        email,
        name: typeof claims['name'] === 'string' ? claims['name'] : null,
        groups: groupsOf(claims),
      },
      { roleMap: oidc.roleMap, defaultRole: oidc.defaultRole },
    );
    if (!outcome.ok) return redirectWith(context, outcome.reason);
    const issued = await options.sessions.issue(options.installationId, outcome.userId);
    await audit(scope, {
      actor: `user:${outcome.userId}`,
      action: 'user.sign-in',
      resourceType: 'user',
      resourceId: outcome.userId,
      // `null` for a person signed in on a membership of another workspace: no role here.
      details: { method: 'oidc', role: outcome.role },
    });
    deleteCookie(context, SIGN_IN_FLOW, { path: '/api/v1/auth/oidc' });
    setCookie(context, SESSION_COOKIE, issued.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isSecureFor(options.secureCookies, context),
      path: '/',
      maxAge: Math.floor(ttlOf(options.sessionTtlMs) / 1000),
    });
    return context.redirect('/', 302);
  });

  return app;
}
