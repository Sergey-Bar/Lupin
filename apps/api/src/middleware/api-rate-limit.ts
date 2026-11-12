import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { bearerToken } from '../http/bearer-token.js';
import { createRateLimiter } from './rate-limit.js';

/**
 * A per-caller request budget on every route outside the probes (plan task 8).
 *
 * The key is the bearer token when one is sent (hashed, so the limiter never holds a
 * credential), and the client address otherwise. One busy pipeline token therefore cannot use
 * up the budget of every browser behind the same proxy, and one address cannot get around it
 * by sending no token.
 */
export interface ApiRateLimitOptions {
  /** Requests per window per caller. */
  limit: number;
  windowMs?: number;
  clientKey: (context: Context) => string;
  now?: () => number;
}

/** Generous for a person and for CI; it exists to stop a runaway loop, not normal use. */
export const DEFAULT_API_RATE_LIMIT = 600;

/**
 * Not budgeted, each for a reason: probes and the scrape (a 429 takes the process out of
 * rotation or breaks monitoring), and the reporter's ingestion routes, which a live test run
 * calls once per event and which carry their own credential.
 */
export const RATE_LIMIT_EXEMPT_PREFIXES = [
  '/health',
  '/ready',
  '/metrics',
  '/api/v1/health',
  '/api/v1/ready',
  '/api/v1/features',
  '/api/v1/reporter/',
] as const;

/** The budget the environment sets, `LUPIN_API_RATE_LIMIT` requests a minute; `0` turns it off. */
export function apiRateLimitFrom(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_API_RATE_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`LUPIN_API_RATE_LIMIT must be a whole number of requests a minute: ${value}`);
  }
  return parsed;
}

export function createApiRateLimit(options: ApiRateLimitOptions): MiddlewareHandler {
  const limiter = createRateLimiter({
    limit: options.limit,
    windowMs: options.windowMs ?? 60_000,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return async (context, next) => {
    const path = context.req.path;
    const exempt =
      options.limit === 0 ||
      RATE_LIMIT_EXEMPT_PREFIXES.some(
        (prefix) => path === prefix || (prefix.endsWith('/') && path.startsWith(prefix)),
      );
    if (!exempt) {
      const token = bearerToken(context.req.header('authorization'));
      const key =
        token === undefined
          ? `client:${options.clientKey(context)}`
          : `token:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
      const decision = limiter.consume(key);
      if (!decision.allowed) {
        context.header('retry-after', String(decision.retryAfterSeconds));
        throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many requests', {
          details: { retryAfterSeconds: decision.retryAfterSeconds },
        });
      }
    }
    await next();
  };
}
