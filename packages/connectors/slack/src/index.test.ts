import { afterEach, describe, expect, it, vi } from 'vitest';
import { slackAdapter } from './index.js';

const request = { operation: 'authTest', input: {} };

/** @param {Array<{ ok: boolean, status: number, body: unknown }>} responses */
function stubFetchSequence(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next === undefined) throw new Error('stubFetchSequence ran out of responses');
    return Promise.resolve({
      ok: next.ok,
      status: next.status,
      json: () => Promise.resolve(next.body),
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('slack adapter', () => {
  it('declares bounded message operations', () => {
    expect(slackAdapter.manifest.name).toBe('slack');
    expect(slackAdapter.manifest.operations.authTest?.sideEffecting).toBe(false);
    expect(slackAdapter.manifest.operations.postMessage?.idempotent).toBe(false);
  });

  it('posts to auth.test with a bearer token and returns the parsed body', async () => {
    const calls = stubFetchSequence([
      { ok: true, status: 200, body: { ok: true, user: 'sergey' } },
    ]);
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(result).toEqual({ status: 'ok', data: { ok: true, user: 'sergey' }, attempts: 1 });
    expect(calls[0]?.url).toBe('https://slack.com/api/auth.test');
    expect(calls[0]?.init?.method).toBe('POST');
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.['authorization']).toBe('Bearer xoxb-token');
  });

  it('retries a 500 and reports the attempt it succeeded on', async () => {
    const calls = stubFetchSequence([
      { ok: false, status: 500, body: {} },
      { ok: true, status: 200, body: { ok: true } },
    ]);
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('refuses a 200 whose body it cannot read, rather than calling it delivered', async () => {
    // Slack answers with a JSON object. A 200 carrying `"ok"` as a bare string is not
    // a delivery, and it is not a refusal either — it is a response this adapter
    // cannot interpret. The `ok` check used to sit behind `typeof parsed === 'object'`,
    // so a non-object body skipped it entirely and came back as `status: 'ok'` with the
    // body as the data: the very thing the `ok` check exists to prevent, one level up.
    const calls = stubFetchSequence([{ ok: true, status: 200, body: 'not an object' }]);
    const result = await slackAdapter.execute({ operation: 'authTest', input: {} }, 'xoxb-token');

    expect(result.status).toBe('error');
    // A response did arrive, so this is not a transport failure; and nothing says the
    // request was refused, so repeating it is not this policy's decision to make.
    expect(result.error?.code).toBe('slack_200');
    expect(result.error?.retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a 401, and reports the status it was given', async () => {
    const calls = stubFetchSequence([{ ok: false, status: 401, body: {} }]);
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(calls).toHaveLength(1);
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(1);
    // The status is in the code, so a caller can tell an expired token from a permission
    // problem without parsing prose. It was `slack_request_failed` — one string for every
    // failure — and then briefly `slack_transport_failed`, which is a different lie: Slack
    // *did* answer, with 401, and a transport failure is by definition a request that got
    // no answer at all. Only the third case below may be a transport failure.
    expect(result.error?.code).toBe('slack_401');
  });

  it('reports the real attempt count after exhausting retries, not a hard-coded 1', async () => {
    const calls = stubFetchSequence([{ ok: false, status: 502, body: {} }]);
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(calls).toHaveLength(3);
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(3);
  });

  it('never leaks the underlying failure text to the result', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('socket hang up')));
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(result.status).toBe('error');
    expect(result.error?.message).toBe('Slack operation failed');
    expect(JSON.stringify(result)).not.toContain('socket hang up');
  });
});

/**
 * The two defects finding P-12 names, plus the one it found.
 *
 * The adapter answered `auth.test` for **every** request, so `postMessage` — declared
 * side-effecting and non-idempotent in the very manifest a caller reads to decide whether
 * to call it — was unreachable, and every "post" silently tested a credential instead. And
 * Slack answers HTTP 200 for a failure: `{"ok": false, "error": "channel_not_found"}` has a
 * 200 status, so the `ok` check on the *response* passed and the refusal came back as
 * `status: 'ok'`.
 */
describe('operation dispatch', () => {
  it('reaches the operation the request names', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { ok: true, ts: '1' } }]);
    const result = await slackAdapter.execute(
      { operation: 'postMessage', input: { channel: 'C123', text: 'hello' } },
      'xoxb-token',
    );

    expect(result.status).toBe('ok');
    expect(calls[0]?.url).toBe('https://slack.com/api/chat.postMessage');
    const init = calls[0]?.init as RequestInit & { body?: string };
    // The body is the caller's input, not a constant. Before the fix the request went
    // out with no body at all, so the message never existed as far as Slack was
    // concerned.
    expect(JSON.parse(String(init.body))).toEqual({ channel: 'C123', text: 'hello' });
  });

  it('refuses an operation its manifest does not declare, without a request', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    const result = await slackAdapter.execute(
      { operation: 'deleteEverything', input: {} },
      'xoxb-token',
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('slack_unknown_operation');
    expect(result.error?.retryable).toBe(false);
    // The counterweight to the refusal above: a dispatcher that reached the network
    // and then refused would still be a dispatcher.
    expect(calls).toHaveLength(0);
  });

  it('refuses a postMessage with no channel, rather than posting to the void', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { ok: true } }]);
    const result = await slackAdapter.execute(
      { operation: 'postMessage', input: { text: 'hello' } },
      'xoxb-token',
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('slack_invalid_input');
    expect(calls).toHaveLength(0);
  });
});

describe('Slack answers failure with HTTP 200', () => {
  it('treats a 200 carrying ok: false as the failure it is', async () => {
    // This is the case the row names, and it cannot be fixed by looking at the HTTP
    // status: Slack's Web API uses 200 for refusals and `ok` for the answer.
    stubFetchSequence([{ ok: true, status: 200, body: { ok: false, error: 'channel_not_found' } }]);
    const result = await slackAdapter.execute(
      { operation: 'postMessage', input: { channel: 'C-nope', text: 'hi' } },
      'xoxb-token',
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('slack_api_error');
  });

  it('does not retry an ok: false that is not a rate limit', async () => {
    const calls = stubFetchSequence([
      { ok: true, status: 200, body: { ok: false, error: 'channel_not_found' } },
    ]);
    const result = await slackAdapter.execute(
      { operation: 'postMessage', input: { channel: 'C-nope', text: 'hi' } },
      'xoxb-token',
    );

    expect(result.status).toBe('error');
    expect(calls).toHaveLength(1);
  });

  it('does retry an ok: false carrying a retryable HTTP status', async () => {
    // Slack reports a rate limit as `ok: false` with a status in the body, so the retry
    // decision has two sources. Before the fix the response check saw a 200 and the
    // refusal came back as a success on the first attempt.
    const calls = stubFetchSequence([
      {
        ok: true,
        status: 200,
        body: { ok: false, error: 'ratelimited', headers: { 'retry-after': '1' } },
      },
      { ok: true, status: 200, body: { ok: true, ts: '1' } },
    ]);
    const result = await slackAdapter.execute(
      { operation: 'postMessage', input: { channel: 'C123', text: 'hi' } },
      'xoxb-token',
    );

    expect(result.status).toBe('ok');
    expect(calls).toHaveLength(2);
  });
});

describe('the reported failure is honest about whether retrying could help', () => {
  it('does not call a rejected credential retryable', async () => {
    // The defect the row found while reading it, and it is the same one twice: the error
    // literal said `retryable: true` on *every* failure, so a 401 and a 401 that would
    // clear in a moment were reported identically. A caller that trusts the flag retries
    // an authentication failure until the budget is gone.
    stubFetchSequence([{ ok: false, status: 401, body: {} }]);
    const result = await slackAdapter.execute(request, 'xoxb-token');

    expect(result.error?.retryable).toBe(false);
  });

  it('reports a 503 as retryable, because it is', async () => {
    const calls = stubFetchSequence([{ ok: false, status: 503, body: {} }]);
    const result = await slackAdapter.execute(request, 'xoxb-token');

    expect(result.error?.retryable).toBe(true);
    expect(calls).toHaveLength(3);
  });
});

/**
 * The parts of the refusal path the cases above do not reach.
 *
 * The adapter's floor is 100%, and these are the branches that got there: the
 * `retry-after`-less rate limit, a refusal with no error name, the `fields` escape
 * hatch, and a transport failure with no status at all. Each one is a decision the
 * adapter makes, and a decision with no case is a decision nobody has checked.
 */
describe('the branches the cases above do not reach', () => {
  it('reads a rate limit named in the body rather than in a header', async () => {
    // Slack puts `retry-after` under `headers` only sometimes, so the error code is the
    // second signal. Without the code check a rate limit is treated as a permanent
    // refusal and the caller is told to fail rather than to wait.
    const calls = stubFetchSequence([
      { ok: true, status: 200, body: { ok: false, error: 'ratelimited' } },
      { ok: true, status: 200, body: { ok: true, ts: '1' } },
    ]);
    const result = await slackAdapter.execute(
      { operation: 'postMessage', input: { channel: 'C123', text: 'hi' } },
      'xoxb-token',
    );

    expect(result.status).toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('reports a refusal with no error name as a plain API error', async () => {
    // `ok: false` with nothing else is still a refusal. Treating it as success is the
    // defect; treating it as an unrecognised *retryable* failure is the other half of it.
    stubFetchSequence([{ ok: true, status: 200, body: { ok: false } }]);
    const result = await slackAdapter.execute(
      { operation: 'postMessage', input: { channel: 'C123', text: 'hi' } },
      'xoxb-token',
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('slack_api_error');
    expect(result.error?.retryable).toBe(false);
  });

  it('sends extra body fields the caller supplied', async () => {
    // `fields` is the escape hatch: anything Slack's method accepts that this adapter does
    // not model. Asserted because a cast that dropped it would look identical in every
    // other test here.
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { ok: true } }]);
    await slackAdapter.execute(
      {
        operation: 'postMessage',
        input: { channel: 'C123', text: 'hi', fields: { thread_ts: '1699.1' } },
      },
      'xoxb-token',
    );

    const init = calls[0]?.init as RequestInit & { body?: string };
    expect(JSON.parse(String(init.body))).toEqual({
      channel: 'C123',
      text: 'hi',
      thread_ts: '1699.1',
    });
  });

  it('forwards a nested object in `fields`, because that is what the escape hatch is for', async () => {
    // `fields` exists for everything this adapter does not model, and the largest thing it
    // does not model is `blocks` — Slack's block kit payload is an array of nested objects.
    // Filtering to strings would make the escape hatch useless for the single most common
    // reason a caller reaches for it, so a nested value is forwarded whole. An earlier
    // version of this test asserted the opposite, on the reasoning that forwarding an
    // unvalidated nested value is how a connector sends a body the remote rejects for
    // reasons the caller cannot see. That reasoning does not survive contact with the API
    // surface: the alternative is not validation, it is *silently dropping* the blocks, so
    // the message goes out without its formatting and the caller learns nothing.
    //
    // What actually protects the caller is the refusal that already exists and is asserted
    // above: a non-object `fields` is dropped rather than forwarded. Slack's own validation
    // answer for a malformed block payload is a 200 with `ok: false` and an error code,
    // which is reported as `slack_api_error` and is not retried.
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { ok: true } }]);
    await slackAdapter.execute(
      {
        operation: 'postMessage',
        input: { channel: 'C123', text: 'hi', fields: { blocks: { not: 'an array' } } },
      },
      'xoxb-token',
    );

    const init = calls[0]?.init as RequestInit & { body?: string };
    expect(JSON.parse(String(init.body))).toEqual({
      channel: 'C123',
      text: 'hi',
      blocks: { not: 'an array' },
    });
  });

  it('ignores `fields` that is not an object at all', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { ok: true } }]);
    await slackAdapter.execute(
      { operation: 'postMessage', input: { channel: 'C123', text: 'hi', fields: 'nope' } },
      'xoxb-token',
    );

    const init = calls[0]?.init as RequestInit & { body?: string };
    expect(JSON.parse(String(init.body))).toEqual({ channel: 'C123', text: 'hi' });
  });

  it('reports a transport failure under its own code, and as not retryable', async () => {
    // A socket hang-up says nothing about whether Slack did the work, so it is neither a
    // rejection nor a confirmed outcome. It is also *distinguishable* from every case above:
    // no status arrived, so there is nothing to put in the code but the fact that nothing
    // did. Mapping it to a 500 — which is the first thing this adapter did — makes
    // `isRetryableStatus(500)` report a dead socket as a transient server fault, and a
    // caller that trusts the flag spends its whole budget on one blip.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('socket hang up')));
    const result = await slackAdapter.execute({ operation: 'authTest', input: {} }, 'xoxb-token');

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('slack_transport_failed');
    expect(result.error?.retryable).toBe(false);
    expect(JSON.stringify(result)).not.toContain('socket hang up');
  });
});

describe('slack adapter: postMessageWithImage', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('rest-of-the-image'),
  ]);
  const post = (extra: Record<string, unknown> = {}) => ({
    operation: 'postMessageWithImage',
    input: {
      channel: 'C0123456789',
      text: '*Weekly* Down 6 points',
      photoBase64: png.toString('base64'),
      title: 'Pace against quality',
      ...extra,
    },
  });
  const UPLOAD_URL = 'https://files.slack.com/upload/v1/ABC';
  const happy = () =>
    stubFetchSequence([
      { ok: true, status: 200, body: { ok: true, upload_url: UPLOAD_URL, file_id: 'F123' } },
      { ok: true, status: 200, body: 'OK - 24' },
      { ok: true, status: 200, body: { ok: true, files: [{ id: 'F123' }] } },
    ]);

  it('declares the upload as a post that is not repeated blindly', () => {
    expect(slackAdapter.manifest.operations['postMessageWithImage']).toEqual({
      sideEffecting: true,
      idempotent: false,
      timeoutMs: 30_000,
    });
  });

  it('asks for an upload address, sends the bytes there, and posts the file with the text', async () => {
    const calls = happy();
    const result = await slackAdapter.execute(post(), 'xoxb-token');
    expect(result).toEqual({ status: 'ok', data: { fileId: 'F123' }, attempts: 1 });
    expect(calls.map((call) => call.url)).toEqual([
      'https://slack.com/api/files.getUploadURLExternal',
      UPLOAD_URL,
      'https://slack.com/api/files.completeUploadExternal',
    ]);
    const first = new URLSearchParams(String(calls[0]?.init?.body));
    expect(first.get('filename')).toBe('chart.png');
    expect(first.get('length')).toBe(String(png.length));
    expect(Buffer.from(calls[1]?.init?.body as Uint8Array).equals(png)).toBe(true);
    const last = new URLSearchParams(String(calls[2]?.init?.body));
    expect(last.get('channel_id')).toBe('C0123456789');
    expect(last.get('initial_comment')).toBe('*Weekly* Down 6 points');
    expect(JSON.parse(last.get('files') as string)).toEqual([
      { id: 'F123', title: 'Pace against quality' },
    ]);
  });

  it('sends the token to Slack’s API and never to the upload address', async () => {
    const calls = happy();
    await slackAdapter.execute(post(), 'xoxb-token');
    const auth = (index: number) =>
      JSON.stringify((calls[index]?.init?.headers ?? {}) as Record<string, string>);
    expect(auth(0)).toContain('Bearer xoxb-token');
    expect(auth(2)).toContain('Bearer xoxb-token');
    expect(auth(1)).not.toContain('xoxb-token');
    expect(auth(1).toLowerCase()).not.toContain('authorization');
  });

  it('refuses an upload address that is not Slack’s, so a reply cannot send the picture elsewhere', async () => {
    const calls = stubFetchSequence([
      {
        ok: true,
        status: 200,
        body: { ok: true, upload_url: 'https://evil.example/upload', file_id: 'F123' },
      },
    ]);
    const result = await slackAdapter.execute(post(), 'xoxb-token');
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('slack_invalid_upload_url');
    expect(calls).toHaveLength(1);
  });

  it('needs a channel id, because a name cannot be posted to by an upload, and asks Slack nothing', async () => {
    const calls = happy();
    const result = await slackAdapter.execute(post({ channel: '#reports' }), 'xoxb-token');
    expect(result.error).toMatchObject({ code: 'slack_channel_id_required', retryable: false });
    expect(calls).toHaveLength(0);
  });

  it('refuses something that is not a PNG, and a missing field, before any request', async () => {
    const calls = happy();
    const html = await slackAdapter.execute(
      post({ photoBase64: Buffer.from('<html></html>').toString('base64') }),
      'xoxb-token',
    );
    expect(html.error?.code).toBe('slack_invalid_photo');
    const missing = await slackAdapter.execute(
      { operation: 'postMessageWithImage', input: { channel: 'C0123456789', text: 't' } },
      'xoxb-token',
    );
    expect(missing.error?.code).toBe('slack_invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('stops at a missing scope after one call, so nothing was posted and the text can still go', async () => {
    const calls = stubFetchSequence([
      { ok: true, status: 200, body: { ok: false, error: 'missing_scope' } },
    ]);
    const result = await slackAdapter.execute(post(), 'xoxb-token');
    expect(result.error).toMatchObject({ code: 'slack_api_error', retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('does not repeat any step after an answer that may have been delivered', async () => {
    const calls = stubFetchSequence([
      { ok: true, status: 200, body: { ok: true, upload_url: UPLOAD_URL, file_id: 'F123' } },
      { ok: true, status: 200, body: 'OK - 24' },
      { ok: false, status: 502, body: {} },
      { ok: true, status: 200, body: { ok: true } },
    ]);
    const result = await slackAdapter.execute(post(), 'xoxb-token');
    // The post answered 502, which may follow a message that arrived: nothing is sent again.
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('slack_502');
    expect(result.attempts).toBe(1);
    expect(calls.map((call) => call.url)).toEqual([
      'https://slack.com/api/files.getUploadURLExternal',
      UPLOAD_URL,
      'https://slack.com/api/files.completeUploadExternal',
    ]);
  });

  it('reports a failed byte upload as the status Slack answered, and posts nothing', async () => {
    const calls = stubFetchSequence([
      { ok: true, status: 200, body: { ok: true, upload_url: UPLOAD_URL, file_id: 'F123' } },
      { ok: false, status: 500, body: 'broken' },
      { ok: false, status: 500, body: 'broken' },
      { ok: false, status: 500, body: 'broken' },
    ]);
    const result = await slackAdapter.execute(post(), 'xoxb-token');
    expect(result.error?.code).toBe('slack_500');
    // The completing call, the one that posts, was never made.
    expect(calls.some((call) => call.url.endsWith('completeUploadExternal'))).toBe(false);
  });

  it('starts the whole upload again after a refusal that says nothing was posted', async () => {
    const calls = stubFetchSequence([
      { ok: true, status: 200, body: { ok: true, upload_url: UPLOAD_URL, file_id: 'F1' } },
      { ok: true, status: 200, body: 'OK' },
      { ok: true, status: 200, body: { ok: false, error: 'ratelimited' } },
      { ok: true, status: 200, body: { ok: true, upload_url: UPLOAD_URL, file_id: 'F2' } },
      { ok: true, status: 200, body: 'OK' },
      { ok: true, status: 200, body: { ok: true } },
    ]);
    const result = await slackAdapter.execute(post(), 'xoxb-token');
    expect(result).toEqual({ status: 'ok', data: { fileId: 'F2' }, attempts: 2 });
    expect(calls).toHaveLength(6);
  });

  it('reads a refusal to post as a refusal, final for a channel the bot is not in', async () => {
    stubFetchSequence([
      { ok: true, status: 200, body: { ok: true, upload_url: UPLOAD_URL, file_id: 'F123' } },
      { ok: true, status: 200, body: 'OK - 24' },
      { ok: true, status: 200, body: { ok: false, error: 'not_in_channel' } },
    ]);
    const result = await slackAdapter.execute(post(), 'xoxb-token');
    expect(result.error).toMatchObject({ code: 'slack_api_error', retryable: false });
  });

  it('never puts the token in an error', async () => {
    stubFetchSequence([{ ok: false, status: 401, body: { ok: false, error: 'invalid_auth' } }]);
    const result = await slackAdapter.execute(post(), 'xoxb-SECRET');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

describe('slack adapter: postMessageWithImage, the answers it does not trust', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('x'),
  ]);
  const post = (extra: Record<string, unknown> = {}) => ({
    operation: 'postMessageWithImage',
    input: { channel: 'C0123456789', text: 't', photoBase64: png.toString('base64'), ...extra },
  });

  it('reports a reply that is not an object as an unusable answer, not as a delivery', async () => {
    stubFetchSequence([{ ok: true, status: 200, body: 'not an object' }]);
    const result = await slackAdapter.execute(post(), 'xoxb-token');
    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ code: 'slack_200', retryable: false });
  });

  it('refuses an empty picture and one over the size it will send', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { ok: true } }]);
    const empty = await slackAdapter.execute(post({ photoBase64: '' }), 'xoxb-token');
    expect(empty.error?.code).toBe('slack_invalid_input');
    const big = await slackAdapter.execute(
      post({ photoBase64: Buffer.concat([png, Buffer.alloc(1_100_000)]).toString('base64') }),
      'xoxb-token',
    );
    expect(big.error?.code).toBe('slack_invalid_photo');
    expect(calls).toHaveLength(0);
  });

  it('refuses a reply that names no upload address, and one that is not a URL', async () => {
    stubFetchSequence([{ ok: true, status: 200, body: { ok: true, file_id: 'F1' } }]);
    const none = await slackAdapter.execute(post(), 'xoxb-token');
    expect(none.error?.code).toBe('slack_200');
    stubFetchSequence([
      { ok: true, status: 200, body: { ok: true, upload_url: 'not a url', file_id: 'F1' } },
    ]);
    const bad = await slackAdapter.execute(post(), 'xoxb-token');
    expect(bad.error?.code).toBe('slack_invalid_upload_url');
  });

  it('refuses an upload address that is http, even on slack.com', async () => {
    const calls = stubFetchSequence([
      {
        ok: true,
        status: 200,
        body: { ok: true, upload_url: 'http://files.slack.com/upload/x', file_id: 'F1' },
      },
    ]);
    const result = await slackAdapter.execute(post(), 'xoxb-token');
    expect(result.error?.code).toBe('slack_invalid_upload_url');
    expect(calls).toHaveLength(1);
  });

  it('titles the file by what the caller says, and by “chart” when it says nothing', async () => {
    const reply = [
      {
        ok: true,
        status: 200,
        body: { ok: true, upload_url: 'https://files.slack.com/u', file_id: 'F1' },
      },
      { ok: true, status: 200, body: 'OK' },
      { ok: true, status: 200, body: { ok: true } },
    ];
    const withTitle = stubFetchSequence(reply);
    await slackAdapter.execute(post({ title: 'T'.repeat(300) }), 'xoxb-token');
    const titled = JSON.parse(
      new URLSearchParams(String(withTitle[2]?.init?.body)).get('files') as string,
    ) as Array<{ title: string }>;
    expect(titled[0]?.title).toHaveLength(100);
    const without = stubFetchSequence(reply);
    await slackAdapter.execute(post(), 'xoxb-token');
    const plain = JSON.parse(
      new URLSearchParams(String(without[2]?.init?.body)).get('files') as string,
    ) as Array<{ title: string }>;
    expect(plain[0]?.title).toBe('chart');
  });
});
