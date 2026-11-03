import {
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  connectorFailure,
  dispatchEntry,
  executeWithRetry,
  requireString,
  type ConnectorAdapter,
  type ConnectorRequest,
  type ConnectorResult,
} from '@lupin/connectors-sdk';

/**
 * Email, through a self-hosted HTTP email bridge.
 *
 * There is no SMTP client in the Node standard library, and adding one would make this the
 * first connector in the tree with a runtime dependency beyond `fetch` — a widening of the
 * supply-chain surface the repository audits, for a reporting email. So email is sent the way
 * Signal is: a small bridge the operator runs (their provider's HTTP send API, or a container
 * that speaks SMTP on one side and `POST /send` on the other) answers a JSON request. The
 * secret is the bridge's base URL, set by an admin; the sender, recipients and subject arrive
 * in the input, assembled by the dispatcher from the channel's settings and the report.
 *
 * The bridge answers 2xx for a sent message and a 4xx JSON `{ error }` for one it refused; a
 * 5xx after a send may have reached the mail server, so it is not retried for a send — the
 * same rule every other connector here follows, so a retry never duplicates a message that
 * arrived.
 */

interface EmailOperation {
  readonly path: string;
  readonly method: 'GET' | 'POST';
}

const OPERATIONS: Record<string, EmailOperation> = {
  about: { path: '/about', method: 'GET' },
  send: { path: '/send', method: 'POST' },
};

function bridgeBase(secret: string): string {
  let url: URL;
  try {
    url = new URL(secret);
  } catch {
    throw new ConnectorInputError('invalid_bridge', 'The email bridge is not a URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
    throw new ConnectorInputError('invalid_bridge', 'The email bridge must be an http(s) URL');
  }
  return url.origin;
}

/** A 4xx is the bridge refusing (nothing sent); a 5xx may have reached the mail server. */
function bridgeError(status: number): ConnectorHttpError {
  return status < 500
    ? new ConnectorRejectionError(status, 'The email bridge refused the request')
    : new ConnectorHttpError(status, 'The email bridge failed');
}

/**
 * The send body: a sender, one or more recipients, a subject, and the report as HTML with a
 * plain-text alternative. `html` is optional — a digest-format email carries only `text` — so
 * it is read only when present rather than required.
 */
function sendBody(input: unknown): Record<string, unknown> {
  const recipients = requireString(input, 'to')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (recipients.length === 0) {
    throw new ConnectorInputError('invalid_input', 'An email needs at least one recipient');
  }
  const record = input as Record<string, unknown>;
  const html = record['html'];
  return {
    from: requireString(input, 'from'),
    to: recipients,
    subject: requireString(input, 'subject'),
    text: requireString(input, 'text'),
    ...(typeof html === 'string' && html.length > 0 ? { html } : {}),
  };
}

export const emailAdapter: ConnectorAdapter = {
  manifest: {
    name: 'email',
    version: '1.0.0',
    operations: {
      about: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      send: { sideEffecting: true, idempotent: false, timeoutMs: 20_000 },
    },
  },

  async execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult> {
    try {
      const { entry, idempotent, timeoutMs } = dispatchEntry(
        emailAdapter.manifest,
        OPERATIONS,
        request.operation,
      );
      const base = bridgeBase(secret);
      const body = entry.method === 'POST' ? JSON.stringify(sendBody(request.input)) : undefined;
      const value = await executeWithRetry(
        async (signal) => {
          const response = await fetch(`${base}${entry.path}`, {
            method: entry.method,
            ...(body === undefined
              ? {}
              : { headers: { 'content-type': 'application/json' }, body }),
            redirect: 'error',
            signal,
          });
          if (!response.ok) throw bridgeError(response.status);
          return (await response.json().catch(() => ({}))) as unknown;
        },
        { retries: 2, signal: request.signal, idempotent, attemptTimeoutMs: timeoutMs },
      );
      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      return connectorFailure('email', error, 'Email operation failed');
    }
  },
};
