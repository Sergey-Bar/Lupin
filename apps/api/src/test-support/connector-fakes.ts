/**
 * Fakes of the seven platforms the connectors talk to, built from each platform's public API
 * documentation, read on 2026-11-18. They stand in at the one boundary every adapter crosses,
 * `globalThis.fetch`, so the **real** adapter builds the **real** request and the fake judges
 * it as the platform would: a request the platform would refuse is refused here, with the
 * platform's own refusal shape. Each fake can also be scripted to answer 429 or 5xx next.
 *
 * What this proves is `fake-verified` in `docs/quality/release-journeys.json`: the request is
 * what the documentation says to send. It does not prove the platform still says so today;
 * that is `live-verified`, the opt-in `connectors-live` workflow, run with real accounts.
 *
 * A fake is deliberately strict about what the docs require and lenient about everything else,
 * so a test fails for a request the platform would refuse, not for one it would accept.
 */

export interface RecordedRequest {
  platform: Platform;
  method: string;
  url: string;
  headers: Record<string, string>;
  /** JSON-decoded when the body was JSON, the form's entries when it was a form, else text. */
  body: unknown;
}

export type Platform = 'slack' | 'teams' | 'telegram' | 'whatsapp' | 'signal' | 'jira' | 'github';

/** Where each fake's rules come from, so a reader can check them against the platform. */
export const FAKE_SOURCES: Readonly<Record<Platform, readonly string[]>> = {
  slack: [
    'https://api.slack.com/methods/chat.postMessage',
    'https://api.slack.com/web#posting_json',
  ],
  teams: [
    'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using',
    'https://learn.microsoft.com/en-us/connectors/teams/?tabs=text1#microsoft-teams-webhook',
  ],
  telegram: [
    'https://core.telegram.org/bots/api#making-requests',
    'https://core.telegram.org/bots/api#sendmessage',
  ],
  whatsapp: [
    'https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages',
    'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes',
  ],
  signal: ['https://bbernhard.github.io/signal-cli-rest-api/#/Messages/post_v2_send'],
  jira: [
    'https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post',
    'https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/',
  ],
  github: ['https://docs.github.com/en/rest/commits/statuses#create-a-commit-status'],
};

export const FAKE_READ_ON = '2026-11-18';

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
type Scripted = 'rate-limit' | 'server-error';

export interface ConnectorFakes {
  /** Every request any fake received, oldest first. */
  requests: RecordedRequest[];
  /** The next request to `platform` gets this answer instead of being judged. */
  script(platform: Platform, next: Scripted): void;
  /** Puts the original `fetch` back. */
  restore(): void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Reply => ({
  status,
  body,
  headers: { 'content-type': 'application/json', ...headers },
});

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function bodyOf(init: RequestInit | undefined): Promise<unknown> {
  const raw = init?.body;
  if (raw === undefined || raw === null) return undefined;
  if (raw instanceof FormData)
    return Object.fromEntries([...raw.keys()].map((key) => [key, raw.get(key)]));
  if (raw instanceof URLSearchParams) return Object.fromEntries(raw.entries());
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

// ─── Each platform, as its documentation describes it ───────────────────────

/** Slack Web API: JSON POST, bearer token, `channel` and `text`; refusals are 200 with ok:false. */
function slack(url: URL, headers: Record<string, string>, body: unknown): Reply {
  if (!/^Bearer xox[abp]-/u.test(headers['authorization'] ?? '')) {
    return json(200, { ok: false, error: 'not_authed' });
  }
  if (url.pathname === '/api/auth.test')
    return json(200, { ok: true, team: 'fake', user: 'lupin' });
  if (url.pathname !== '/api/chat.postMessage')
    return json(200, { ok: false, error: 'unknown_method' });
  if (!(headers['content-type'] ?? '').startsWith('application/json')) {
    return json(200, { ok: false, error: 'invalid_form_data' });
  }
  if (!isRecord(body) || !nonEmpty(body['channel']))
    return json(200, { ok: false, error: 'channel_not_found' });
  if (!nonEmpty(body['text']) && body['blocks'] === undefined)
    return json(200, { ok: false, error: 'no_text' });
  if (typeof body['text'] === 'string' && body['text'].length > 40_000) {
    return json(200, { ok: false, error: 'msg_too_long' });
  }
  return json(200, { ok: true, channel: body['channel'], ts: '1700000000.000100' });
}

/** Teams incoming webhook: JSON POST of a MessageCard or an Adaptive Card message; 200 "1". */
function teams(_url: URL, headers: Record<string, string>, body: unknown): Reply {
  if (!(headers['content-type'] ?? '').startsWith('application/json'))
    return json(400, 'Bad payload');
  if (!isRecord(body)) return json(400, 'Bad payload');
  const messageCard =
    body['@type'] === 'MessageCard' && (nonEmpty(body['text']) || Array.isArray(body['sections']));
  const adaptive =
    body['type'] === 'message' &&
    Array.isArray(body['attachments']) &&
    body['attachments'].every(
      (item) => isRecord(item) && item['contentType'] === 'application/vnd.microsoft.card.adaptive',
    );
  if (!messageCard && !adaptive) return json(400, 'Summary or Text is required.');
  return { status: 200, body: '1', headers: { 'content-type': 'text/plain' } };
}

/** Telegram Bot API: /bot<token>/<method>; every answer is {ok, result} or {ok:false, error_code}. */
function telegram(url: URL, _headers: Record<string, string>, body: unknown): Reply {
  const match = /^\/bot(\d+:[A-Za-z0-9_-]+)\/(\w+)$/u.exec(url.pathname);
  if (match === null) return json(404, { ok: false, error_code: 404, description: 'Not Found' });
  const method = match[2];
  if (method === 'getMe')
    return json(200, { ok: true, result: { id: 1, is_bot: true, username: 'lupin_bot' } });
  if (method !== 'sendMessage' && method !== 'sendPhoto') {
    return json(404, { ok: false, error_code: 404, description: 'Not Found: method not found' });
  }
  if (!isRecord(body) || !nonEmpty(body['chat_id'])) {
    return json(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
  }
  if (method === 'sendMessage') {
    const text = body['text'];
    if (!nonEmpty(text))
      return json(400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: message text is empty',
      });
    if (text.length > 4096)
      return json(400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: message is too long',
      });
  } else {
    if (body['photo'] === undefined)
      return json(400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: there is no photo in the request',
      });
    if (typeof body['caption'] === 'string' && body['caption'].length > 1024) {
      return json(400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: message caption is too long',
      });
    }
  }
  return json(200, { ok: true, result: { message_id: 7, chat: { id: body['chat_id'] } } });
}

/** WhatsApp Cloud API: POST /<version>/<phone-id>/messages, bearer token, a template message. */
function whatsapp(url: URL, headers: Record<string, string>, body: unknown): Reply {
  if (!(headers['authorization'] ?? '').startsWith('Bearer ')) {
    return json(401, {
      error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 },
    });
  }
  const match = /^\/v\d+\.\d+\/(\d+)(\/messages)?$/u.exec(url.pathname);
  if (match === null) return json(400, { error: { message: 'Unsupported request', code: 100 } });
  if (match[2] === undefined)
    return json(200, { id: match[1], display_phone_number: '+1 555 0100' });
  const template = isRecord(body) ? body['template'] : undefined;
  if (
    !isRecord(body) ||
    body['messaging_product'] !== 'whatsapp' ||
    !nonEmpty(body['to']) ||
    body['type'] !== 'template' ||
    !isRecord(template) ||
    !nonEmpty(template['name']) ||
    !isRecord(template['language']) ||
    !nonEmpty((template['language'] as Record<string, unknown>)['code'])
  ) {
    return json(400, {
      error: { message: '(#100) Invalid parameter', type: 'OAuthException', code: 100 },
    });
  }
  const components = Array.isArray(template['components']) ? template['components'] : [];
  for (const component of components) {
    const parameters =
      isRecord(component) && Array.isArray(component['parameters']) ? component['parameters'] : [];
    for (const parameter of parameters) {
      const text = isRecord(parameter) ? parameter['text'] : undefined;
      // A template body parameter may not contain a new line or tab (error 132018 family).
      if (typeof text === 'string' && /[\n\t]|\s{5,}/u.test(text)) {
        return json(400, {
          error: {
            message:
              'Param text cannot have new-line/tab characters or more than 4 consecutive spaces',
            code: 132018,
          },
        });
      }
    }
  }
  return json(200, {
    messaging_product: 'whatsapp',
    contacts: [{ input: body['to'], wa_id: body['to'] }],
    messages: [{ id: 'wamid.FAKE' }],
  });
}

/** signal-cli-rest-api: POST /v2/send {number, recipients[], message}; 201 {timestamp}. */
function signal(url: URL, _headers: Record<string, string>, body: unknown): Reply {
  if (url.pathname === '/v1/about') return json(200, { versions: ['v1', 'v2'], mode: 'normal' });
  if (url.pathname !== '/v2/send') return json(404, { error: 'not found' });
  if (
    !isRecord(body) ||
    !/^\+\d{7,15}$/u.test(String(body['number'])) ||
    !Array.isArray(body['recipients']) ||
    body['recipients'].length === 0 ||
    !nonEmpty(body['message'])
  ) {
    return json(400, { error: "Couldn't process request - invalid request" });
  }
  return json(201, { timestamp: '1700000000000' });
}

/** Jira Cloud REST v3: POST /rest/api/3/issue; `description` must be an Atlassian Document. */
function jira(url: URL, headers: Record<string, string>, body: unknown): Reply {
  if (!(headers['authorization'] ?? '').startsWith('Bearer ')) {
    return json(401, { errorMessages: ['You are not authenticated.'], errors: {} });
  }
  if (url.pathname === '/rest/api/3/myself')
    return json(200, { accountId: 'fake', displayName: 'Lupin' });
  if (url.pathname !== '/rest/api/3/issue')
    return json(404, { errorMessages: ['Not found'], errors: {} });
  const fields = isRecord(body) ? body['fields'] : undefined;
  const errors: Record<string, string> = {};
  if (!isRecord(fields)) return json(400, { errorMessages: ['fields is required'], errors });
  if (
    !isRecord(fields['project']) ||
    !nonEmpty((fields['project'] as Record<string, unknown>)['key'])
  ) {
    errors['project'] = 'Specify a valid project ID or key';
  }
  if (
    !isRecord(fields['issuetype']) ||
    !nonEmpty((fields['issuetype'] as Record<string, unknown>)['name'])
  ) {
    errors['issuetype'] = 'Specify an issue type';
  }
  if (!nonEmpty(fields['summary'])) errors['summary'] = 'You must specify a summary of the issue.';
  else if (fields['summary'].length > 255)
    errors['summary'] = 'Summary must be less than 255 characters.';
  const description = fields['description'];
  if (
    description !== undefined &&
    !(isRecord(description) && description['type'] === 'doc' && description['version'] === 1)
  ) {
    errors['description'] =
      'Operation value must be an Atlassian Document (see the Atlassian Document Format).';
  }
  if (Object.keys(errors).length > 0) return json(400, { errorMessages: [], errors });
  return json(201, {
    id: '10001',
    key: `${String((fields['project'] as Record<string, unknown>)['key'])}-1`,
    self: `${url.origin}/rest/api/3/issue/10001`,
  });
}

/** GitHub REST: POST /repos/{owner}/{repo}/statuses/{sha}; state is one of four. */
function github(url: URL, headers: Record<string, string>, body: unknown): Reply {
  if (!/^(Bearer|token) /u.test(headers['authorization'] ?? '')) {
    return json(401, { message: 'Requires authentication' });
  }
  const status = /^\/repos\/[^/]+\/[^/]+\/statuses\/([0-9a-f]{7,40})$/u.exec(url.pathname);
  if (status !== null) {
    const state = isRecord(body) ? body['state'] : undefined;
    if (!['error', 'failure', 'pending', 'success'].includes(String(state))) {
      return json(422, {
        message: 'Validation Failed',
        errors: [{ resource: 'Status', field: 'state', code: 'invalid' }],
      });
    }
    const description = isRecord(body) ? body['description'] : undefined;
    if (typeof description === 'string' && description.length > 140) {
      return json(422, {
        message: 'Validation Failed',
        errors: [{ resource: 'Status', field: 'description', code: 'custom' }],
      });
    }
    return json(201, {
      id: 1,
      state,
      context: isRecord(body) ? (body['context'] ?? 'default') : 'default',
    });
  }
  return json(404, { message: 'Not Found' });
}

const HOSTS: ReadonlyArray<{
  platform: Platform;
  matches: (url: URL) => boolean;
  judge: typeof slack;
}> = [
  { platform: 'slack', matches: (url) => url.host === 'slack.com', judge: slack },
  {
    platform: 'teams',
    matches: (url) =>
      url.host.endsWith('.webhook.office.com') || url.host.endsWith('.logic.azure.com'),
    judge: teams,
  },
  { platform: 'telegram', matches: (url) => url.host === 'api.telegram.org', judge: telegram },
  { platform: 'whatsapp', matches: (url) => url.host === 'graph.facebook.com', judge: whatsapp },
  { platform: 'signal', matches: (url) => url.hostname === 'signal-bridge.test', judge: signal },
  { platform: 'jira', matches: (url) => url.host.endsWith('.atlassian.net'), judge: jira },
  { platform: 'github', matches: (url) => url.host === 'api.github.com', judge: github },
];

/** The Signal bridge's address in tests: a host only the fake answers. */
export const FAKE_SIGNAL_BRIDGE = 'http://signal-bridge.test:8080';

/**
 * Replaces `globalThis.fetch` with the fakes. A request to any other host fails loudly, so a
 * test can never reach a real platform by accident.
 */
export function installConnectorFakes(): ConnectorFakes {
  const original = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  const scripted = new Map<Platform, Scripted[]>();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const host = HOSTS.find((entry) => entry.matches(url));
    if (host === undefined)
      throw new Error(
        `connector fakes: no fake for ${url.host}; a test must not reach the network`,
      );
    const headers = headersOf(init);
    const body = await bodyOf(init);
    requests.push({
      platform: host.platform,
      method: init?.method ?? 'GET',
      url: url.href,
      headers,
      body,
    });
    const next = scripted.get(host.platform)?.shift();
    const reply =
      next === 'rate-limit'
        ? json(429, { ok: false, error: 'ratelimited', error_code: 429 }, { 'retry-after': '0' })
        : next === 'server-error'
          ? json(503, { message: 'Service Unavailable' })
          : host.judge(url, headers, body);
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status, headers: reply.headers });
  }) as typeof fetch;
  return {
    requests,
    script(platform, next) {
      scripted.set(platform, [...(scripted.get(platform) ?? []), next]);
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}
