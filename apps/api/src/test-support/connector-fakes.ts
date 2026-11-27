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

/**
 * A platform's own refusal field. Slack and signal-cli answer with `error` as a bare string;
 * built here so this file reproduces that shape without writing one of this API's own bodies.
 */
const platformError = (message: string): { error: string } => ({ ['error']: message });

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

/**
 * The first refusal whose condition holds, else `accept()`. Each platform below is a list of
 * documented refusals in the order the platform checks them, so a rule is one line a reader can
 * hold against the documentation, and no judge is a ladder of branches.
 */
type Rule = readonly [refuses: () => boolean, reply: () => Reply];
function judge(rules: readonly Rule[], accept: () => Reply): Reply {
  return rules.find(([refuses]) => refuses())?.[1]() ?? accept();
}

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);
const header = (headers: Record<string, string>, name: string): string => headers[name] ?? '';

/** Slack Web API: JSON POST, bearer token, `channel` and `text`; refusals are 200 with ok:false. */
function slack(url: URL, headers: Record<string, string>, body: unknown): Reply {
  if (
    url.pathname === '/api/auth.test' &&
    /^Bearer xox[abp]-/u.test(header(headers, 'authorization'))
  ) {
    return json(200, { ok: true, team: 'fake', user: 'lupin' });
  }
  const refusal = (code: string) => () => json(200, { ok: false, ...platformError(code) });
  const text = field(body, 'text');
  return judge(
    [
      [() => !/^Bearer xox[abp]-/u.test(header(headers, 'authorization')), refusal('not_authed')],
      [() => url.pathname !== '/api/chat.postMessage', refusal('unknown_method')],
      [
        () => !header(headers, 'content-type').startsWith('application/json'),
        refusal('invalid_form_data'),
      ],
      [() => !nonEmpty(field(body, 'channel')), refusal('channel_not_found')],
      [() => !nonEmpty(text) && field(body, 'blocks') === undefined, refusal('no_text')],
      [() => typeof text === 'string' && text.length > 40_000, refusal('msg_too_long')],
    ],
    () => json(200, { ok: true, channel: field(body, 'channel'), ts: '1700000000.000100' }),
  );
}

/** Teams incoming webhook: JSON POST of a MessageCard or an Adaptive Card message; 200 "1". */
function teams(_url: URL, headers: Record<string, string>, body: unknown): Reply {
  const messageCard =
    field(body, '@type') === 'MessageCard' &&
    (nonEmpty(field(body, 'text')) || Array.isArray(field(body, 'sections')));
  const attachments = field(body, 'attachments');
  const adaptive =
    field(body, 'type') === 'message' &&
    Array.isArray(attachments) &&
    attachments.every(
      (item) => field(item, 'contentType') === 'application/vnd.microsoft.card.adaptive',
    );
  return judge(
    [
      [
        () => !header(headers, 'content-type').startsWith('application/json'),
        () => json(400, 'Bad payload'),
      ],
      [() => !messageCard && !adaptive, () => json(400, 'Summary or Text is required.')],
    ],
    () => ({ status: 200, body: '1', headers: { 'content-type': 'text/plain' } }),
  );
}

/** Telegram Bot API: /bot<token>/<method>; every answer is {ok, result} or {ok:false, error_code}. */
function telegram(url: URL, _headers: Record<string, string>, body: unknown): Reply {
  const method = /^\/bot\d+:[A-Za-z0-9_-]+\/(\w+)$/u.exec(url.pathname)?.[1] ?? null;
  const bad = (description: string) => () => json(400, { ok: false, error_code: 400, description });
  const text = field(body, 'text');
  const caption = field(body, 'caption');
  if (method === 'getMe')
    return json(200, { ok: true, result: { id: 1, is_bot: true, username: 'lupin_bot' } });
  return judge(
    [
      [
        () => method !== 'sendMessage' && method !== 'sendPhoto',
        () => json(404, { ok: false, error_code: 404, description: 'Not Found' }),
      ],
      [() => !nonEmpty(field(body, 'chat_id')), bad('Bad Request: chat not found')],
      [
        () => method === 'sendMessage' && !nonEmpty(text),
        bad('Bad Request: message text is empty'),
      ],
      [
        () => method === 'sendMessage' && typeof text === 'string' && text.length > 4096,
        bad('Bad Request: message is too long'),
      ],
      [
        () => method === 'sendPhoto' && field(body, 'photo') === undefined,
        bad('Bad Request: there is no photo in the request'),
      ],
      [
        () => method === 'sendPhoto' && typeof caption === 'string' && caption.length > 1024,
        bad('Bad Request: message caption is too long'),
      ],
    ],
    () => json(200, { ok: true, result: { message_id: 7, chat: { id: field(body, 'chat_id') } } }),
  );
}

/** Every text parameter of a WhatsApp template's components. */
function templateTexts(template: unknown): unknown[] {
  const components = field(template, 'components');
  return (Array.isArray(components) ? components : []).flatMap((component) => {
    const parameters = field(component, 'parameters');
    return (Array.isArray(parameters) ? parameters : []).map((parameter) =>
      field(parameter, 'text'),
    );
  });
}

/** WhatsApp Cloud API: POST /<version>/<phone-id>/messages, bearer token, a template message. */
function whatsapp(url: URL, headers: Record<string, string>, body: unknown): Reply {
  const match = /^\/v\d+\.\d+\/(\d+)(\/messages)?$/u.exec(url.pathname);
  const template = field(body, 'template');
  const invalid = () =>
    json(400, {
      error: { message: '(#100) Invalid parameter', type: 'OAuthException', code: 100 },
    });
  if (
    match !== null &&
    match[2] === undefined &&
    header(headers, 'authorization').startsWith('Bearer ')
  ) {
    return json(200, { id: match[1], display_phone_number: '+1 555 0100' });
  }
  return judge(
    [
      [
        () => !header(headers, 'authorization').startsWith('Bearer '),
        () =>
          json(401, {
            error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 },
          }),
      ],
      [
        () => match === null,
        () => json(400, { error: { message: 'Unsupported request', code: 100 } }),
      ],
      [
        () => field(body, 'messaging_product') !== 'whatsapp' || field(body, 'type') !== 'template',
        invalid,
      ],
      [() => !nonEmpty(field(body, 'to')) || !nonEmpty(field(template, 'name')), invalid],
      [() => !nonEmpty(field(field(template, 'language'), 'code')), invalid],
      // A template body parameter may not contain a new line or tab (error 132018 family).
      [
        () =>
          templateTexts(template).some(
            (text) => typeof text === 'string' && /[\n\t]|\s{5,}/u.test(text),
          ),
        () =>
          json(400, {
            error: {
              message:
                'Param text cannot have new-line/tab characters or more than 4 consecutive spaces',
              code: 132018,
            },
          }),
      ],
    ],
    () =>
      json(200, {
        messaging_product: 'whatsapp',
        contacts: [{ input: field(body, 'to'), wa_id: field(body, 'to') }],
        messages: [{ id: 'wamid.FAKE' }],
      }),
  );
}

/** signal-cli-rest-api: POST /v2/send {number, recipients[], message}; 201 {timestamp}. */
function signal(url: URL, _headers: Record<string, string>, body: unknown): Reply {
  if (url.pathname === '/v1/about') return json(200, { versions: ['v1', 'v2'], mode: 'normal' });
  const recipients = field(body, 'recipients');
  const invalid = () => json(400, { error: "Couldn't process request - invalid request" });
  return judge(
    [
      [() => url.pathname !== '/v2/send', () => json(404, platformError('not found'))],
      [() => !/^\+\d{7,15}$/u.test(String(field(body, 'number'))), invalid],
      [() => !Array.isArray(recipients) || recipients.length === 0, invalid],
      [() => !nonEmpty(field(body, 'message')), invalid],
    ],
    () => json(201, { timestamp: '1700000000000' }),
  );
}

/** What Jira Cloud refuses in an issue's fields, keyed by field, as its 400 body names them. */
function jiraFieldErrors(fields: unknown): Record<string, string> {
  const summary = field(fields, 'summary');
  const description = field(fields, 'description');
  const checks: ReadonlyArray<readonly [string, boolean, string]> = [
    [
      'project',
      !nonEmpty(field(field(fields, 'project'), 'key')),
      'Specify a valid project ID or key',
    ],
    ['issuetype', !nonEmpty(field(field(fields, 'issuetype'), 'name')), 'Specify an issue type'],
    ['summary', !nonEmpty(summary), 'You must specify a summary of the issue.'],
    [
      'summary',
      typeof summary === 'string' && summary.length > 255,
      'Summary must be less than 255 characters.',
    ],
    [
      'description',
      description !== undefined &&
        !(field(description, 'type') === 'doc' && field(description, 'version') === 1),
      'Operation value must be an Atlassian Document (see the Atlassian Document Format).',
    ],
  ];
  return Object.fromEntries(
    checks.filter(([, fails]) => fails).map(([name, , message]) => [name, message]),
  );
}

/** Jira Cloud REST v3: POST /rest/api/3/issue; `description` must be an Atlassian Document. */
function jira(url: URL, headers: Record<string, string>, body: unknown): Reply {
  const authed = header(headers, 'authorization').startsWith('Bearer ');
  if (authed && url.pathname === '/rest/api/3/myself')
    return json(200, { accountId: 'fake', displayName: 'Lupin' });
  const fields = field(body, 'fields');
  const errors = jiraFieldErrors(fields);
  return judge(
    [
      [
        () => !authed,
        () => json(401, { errorMessages: ['You are not authenticated.'], errors: {} }),
      ],
      [
        () => url.pathname !== '/rest/api/3/issue',
        () => json(404, { errorMessages: ['Not found'], errors: {} }),
      ],
      [
        () => !isRecord(fields),
        () => json(400, { errorMessages: ['fields is required'], errors: {} }),
      ],
      [() => Object.keys(errors).length > 0, () => json(400, { errorMessages: [], errors })],
    ],
    () =>
      json(201, {
        id: '10001',
        key: `${String(field(field(fields, 'project'), 'key'))}-1`,
        self: `${url.origin}/rest/api/3/issue/10001`,
      }),
  );
}

/** GitHub REST: POST /repos/{owner}/{repo}/statuses/{sha}; state is one of four. */
function github(url: URL, headers: Record<string, string>, body: unknown): Reply {
  const state = field(body, 'state');
  const description = field(body, 'description');
  const invalid = (name: string, code: string) => () =>
    json(422, {
      message: 'Validation Failed',
      errors: [{ resource: 'Status', field: name, code }],
    });
  return judge(
    [
      [
        () => !/^(Bearer|token) /u.test(header(headers, 'authorization')),
        () => json(401, { message: 'Requires authentication' }),
      ],
      [
        () => !/^\/repos\/[^/]+\/[^/]+\/statuses\/[0-9a-f]{7,40}$/u.test(url.pathname),
        () => json(404, { message: 'Not Found' }),
      ],
      [
        () => !['error', 'failure', 'pending', 'success'].includes(String(state)),
        invalid('state', 'invalid'),
      ],
      [
        () => typeof description === 'string' && description.length > 140,
        invalid('description', 'custom'),
      ],
    ],
    () => json(201, { id: 1, state, context: field(body, 'context') ?? 'default' }),
  );
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
        ? json(
            429,
            { ok: false, ...platformError('ratelimited'), error_code: 429 },
            { 'retry-after': '0' },
          )
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
