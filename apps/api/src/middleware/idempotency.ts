import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { DomainError, ErrorCode } from '../errors/domain-error.js';

/**
 * `Idempotency-Key` for create requests (plan 1795712849115 task 5).
 *
 * Only the runs route honoured the header, through its own durable store. Every other create
 * was a new record per request, so a client that retried after a timeout (a CI step, a phone
 * on a bad connection, a double-clicked button) made two quarantine entries, two scheduled
 * reports, or two Jira issues for one failure cause.
 *
 * With the header, the first request runs and its answer is kept; a repeat with the same key
 * and the same body gets that answer again, marked `x-idempotent-replay: true`, and nothing
 * runs twice. A repeat with a different body is refused (`IDEMPOTENCY_KEY_REUSED`, 409),
 * because answering it with the first result would report success for a request that was
 * never made. A repeat while the first is still running is refused too
 * (`IDEMPOTENCY_KEY_IN_FLIGHT`, 409), so two retries cannot both pass the check.
 *
 * Only a success is kept. A refusal or a fault is forgotten, so the retry it invites runs.
 *
 * **Process-local, on purpose.** ADR-006 is one API process, and a second one is refused at
 * start (ledger MNT-175), so this process sees every request. A restart forgets the keys;
 * a request retried across a restart runs again, which is the behaviour without the header.
 * The window is a day and the table is bounded, oldest first.
 *
 * Without the header the request passes through untouched: the header is the client's claim
 * that a repeat is a repeat, and nothing here guesses it.
 */
export interface IdempotencyOptions {
  /** Who is asking, so two callers' keys never collide. Defaults to the credential sent. */
  callerKey?: (context: Context) => string;
  /** How long a kept answer is replayed. Default: 24 hours. */
  ttlMs?: number;
  /** How many answers are kept. Default: 1,000; the oldest goes first. */
  maxEntries?: number;
  now?: () => number;
}

/** The header, and the bound on its value. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 255;

type Entry =
  | { state: 'running'; fingerprint: string; at: number }
  | {
      state: 'done';
      fingerprint: string;
      at: number;
      status: number;
      contentType: string | null;
      body: string;
    };

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** The credential the request carried, hashed so the table never holds one. */
function defaultCallerKey(context: Context): string {
  const credential =
    context.req.header('authorization') ?? context.req.header('cookie') ?? 'anonymous';
  return sha256(credential).slice(0, 32);
}

function readKey(context: Context): string | undefined {
  const raw = context.req.header(IDEMPOTENCY_HEADER);
  if (raw === undefined) return undefined;
  const key = raw.trim();
  // Printable ASCII only: a key is an identifier a client generated, not text.
  if (key === '' || key.length > MAX_KEY_LENGTH || !/^[\x21-\x7e]+$/u.test(key)) {
    throw new DomainError(ErrorCode.INVALID_REQUEST, 'Idempotency-Key is not a valid key', {
      details: { maxLength: MAX_KEY_LENGTH },
    });
  }
  return key;
}

export function createIdempotency(options: IdempotencyOptions = {}): MiddlewareHandler {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 1000;
  const now = options.now ?? Date.now;
  const callerKey = options.callerKey ?? defaultCallerKey;
  const entries = new Map<string, Entry>();

  const sweep = (at: number): void => {
    for (const [key, entry] of entries) {
      if (at - entry.at <= ttlMs) break; // insertion order is age order
      entries.delete(key);
    }
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return async (context, next) => {
    if (context.req.method !== 'POST') return next();
    const key = readKey(context);
    if (key === undefined) return next();

    const at = now();
    sweep(at);
    const slot = sha256(`${callerKey(context)}\n${context.req.path}\n${key}`);
    // A clone, so the body stays unread for what comes after: a body-limit middleware reads
    // the raw stream, and a consumed one is a locked one.
    const fingerprint = sha256(await context.req.raw.clone().text());
    const seen = entries.get(slot);

    if (seen !== undefined) {
      if (seen.fingerprint !== fingerprint) {
        throw new DomainError(
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
          'This Idempotency-Key was used for a different request',
        );
      }
      if (seen.state === 'running') {
        throw new DomainError(
          ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT,
          'The first request with this Idempotency-Key has not finished',
        );
      }
      context.header('x-idempotent-replay', 'true');
      if (seen.contentType !== null) context.header('content-type', seen.contentType);
      return context.body(seen.body, seen.status as 200);
    }

    entries.set(slot, { state: 'running', fingerprint, at });
    try {
      await next();
    } catch (error) {
      entries.delete(slot);
      throw error;
    }
    const response = context.res;
    if (response.status < 200 || response.status >= 300) {
      entries.delete(slot);
      return;
    }
    const body = await response.clone().text();
    entries.set(slot, {
      state: 'done',
      fingerprint,
      at,
      status: response.status,
      contentType: response.headers.get('content-type'),
      body,
    });
    context.header('x-idempotent-replay', 'false');
  };
}

/**
 * The create routes the composition root puts this in front of.
 *
 * Each makes a record, or a record somewhere else (an issue in Jira or GitHub), per request.
 * Left out, each for a reason: anything that issues a credential (access, SCIM and pairing
 * tokens), because keeping its answer would keep the secret in memory for a day; the runs
 * route, which has a durable store of its own; and the reporter and runner ingestion routes,
 * which are deduplicated by event identity.
 */
export const IDEMPOTENT_CREATE_ROUTES = [
  '/api/v1/dashboard/quarantine',
  '/api/v1/dashboard/quality-gates',
  '/api/v1/dashboard/failure-clusters/issue',
  '/api/v1/projects',
  '/api/v1/projects/:id/signoffs',
  '/api/v1/projects/:id/health/findings/:findingId/issue',
  '/api/v1/quality-policies',
  '/api/v1/notification-channels',
  '/api/v1/report-subscriptions',
] as const;
