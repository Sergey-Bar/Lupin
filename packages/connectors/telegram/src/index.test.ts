import { afterEach, describe, expect, it, vi } from 'vitest';
import { telegramAdapter } from './index.js';

type Reply = { status: number; body: unknown } | Error;

function stubFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = replies[Math.min(index, replies.length - 1)] as Reply;
    index += 1;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: () =>
        next.body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(next.body),
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const send = { operation: 'sendMessage', input: { chatId: '-1001', text: '<b>🟢 ok</b>' } };

describe('telegram adapter', () => {
  it('sends HTML to the chat through the bot token in the path', async () => {
    const calls = stubFetch([{ status: 200, body: { ok: true, result: { message_id: 7 } } }]);
    const result = await telegramAdapter.execute(send, '123:abc');
    expect(result).toEqual({ status: 'ok', data: { message_id: 7 }, attempts: 1 });
    expect(calls[0]?.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      chat_id: '-1001',
      text: '<b>🟢 ok</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  it('checks the token with getMe', async () => {
    stubFetch([{ status: 200, body: { ok: true, result: { username: 'lupin_bot' } } }]);
    const result = await telegramAdapter.execute({ operation: 'getMe', input: {} }, 't');
    expect(result.data).toEqual({ username: 'lupin_bot' });
  });

  it('retries a rate-limit refusal, which sent nothing, even though sending is not idempotent', async () => {
    const calls = stubFetch([
      { status: 429, body: { ok: false, error_code: 429, parameters: { retry_after: 1 } } },
      { status: 200, body: { ok: true, result: {} } },
    ]);
    const result = await telegramAdapter.execute(send, 't');
    expect(result).toMatchObject({ status: 'ok', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 502 with no answer on a send, which may already have been delivered', async () => {
    const calls = stubFetch([
      { status: 502, body: undefined },
      { status: 200, body: { ok: true } },
    ]);
    const result = await telegramAdapter.execute(send, 't');
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ status: 'error', attempts: 1, error: { code: 'telegram_502' } });
  });

  it('reports a malformed 200 as an error, not a delivery, and does not retry the send', async () => {
    const calls = stubFetch([{ status: 200, body: 'ok' }]);
    const result = await telegramAdapter.execute(send, 't');
    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ code: 'telegram_200', retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('treats a bad token or chat as final', async () => {
    stubFetch([{ status: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } }]);
    const result = await telegramAdapter.execute(send, 't');
    expect(result.error).toEqual({
      code: 'telegram_rejected_401',
      retryable: false,
      message: 'Telegram operation failed',
    });
  });

  it('reads a refusal that arrives with HTTP 200 by its body', async () => {
    stubFetch([{ status: 200, body: { ok: false } }]);
    expect((await telegramAdapter.execute(send, 't')).error?.code).toBe('telegram_rejected_400');
    stubFetch([{ status: 409, body: { ok: false, error_code: 'conflict' } }]);
    expect((await telegramAdapter.execute(send, 't')).error?.code).toBe('telegram_rejected_409');
  });

  it('refuses missing input and an unknown operation before any request', async () => {
    const calls = stubFetch([{ status: 200, body: { ok: true } }]);
    const missing = await telegramAdapter.execute(
      { operation: 'sendMessage', input: { chatId: '1' } },
      't',
    );
    expect(missing.error?.code).toBe('telegram_invalid_input');
    const unknown = await telegramAdapter.execute({ operation: 'sendSticker', input: {} }, 't');
    expect(unknown.error?.code).toBe('telegram_unknown_operation');
    expect(calls).toHaveLength(0);
  });

  it('never puts the token in an error, even when the transport fails', async () => {
    stubFetch([new TypeError('fetch failed for https://api.telegram.org/botSECRET/sendMessage')]);
    const result = await telegramAdapter.execute(send, 'SECRET');
    expect(result.error?.code).toBe('telegram_transport_failed');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('reports an unreadable body on an error status by that status', async () => {
    stubFetch([{ status: 503, body: undefined }]);
    const result = await telegramAdapter.execute({ operation: 'getMe', input: {} }, 't');
    expect(result.error).toMatchObject({ code: 'telegram_503', retryable: true });
    expect(result.attempts).toBe(3);
  });
});

describe('telegram adapter: sendPhoto', () => {
  /** A real PNG signature followed by bytes: all the adapter checks is that it is a PNG. */
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('rest-of-the-image'),
  ]);
  const photo = (extra: Record<string, unknown> = {}) => ({
    operation: 'sendPhoto',
    input: {
      chatId: '-1001',
      caption: '<b>Weekly</b> Down 6 points',
      photoBase64: png.toString('base64'),
      ...extra,
    },
  });

  it('declares sendPhoto as a send that is not repeated blindly', () => {
    expect(telegramAdapter.manifest.operations['sendPhoto']).toEqual({
      sideEffecting: true,
      idempotent: false,
      timeoutMs: 20_000,
    });
  });

  it('posts the picture and its caption as a form, through the token in the path', async () => {
    const calls = stubFetch([{ status: 200, body: { ok: true, result: { message_id: 9 } } }]);
    const result = await telegramAdapter.execute(photo(), '123:abc');
    expect(result).toEqual({ status: 'ok', data: { message_id: 9 }, attempts: 1 });
    expect(calls[0]?.url).toBe('https://api.telegram.org/bot123:abc/sendPhoto');
    const form = calls[0]?.init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('chat_id')).toBe('-1001');
    expect(form.get('caption')).toBe('<b>Weekly</b> Down 6 points');
    expect(form.get('parse_mode')).toBe('HTML');
    const file = form.get('photo') as File;
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(png.length);
    expect(Buffer.from(await file.arrayBuffer()).equals(png)).toBe(true);
    // The form sets its own boundary, so no content type of ours may be sent with it.
    expect(JSON.stringify(calls[0]?.init?.headers ?? {})).not.toContain('content-type');
  });

  it('refuses something that is not a PNG before any request', async () => {
    const calls = stubFetch([{ status: 200, body: { ok: true } }]);
    const result = await telegramAdapter.execute(
      photo({ photoBase64: Buffer.from('<html>not an image</html>').toString('base64') }),
      't',
    );
    expect(result.error).toMatchObject({ code: 'telegram_invalid_photo', retryable: false });
    expect(calls).toHaveLength(0);
  });

  it('refuses a caption Telegram would cut, and a picture larger than it is willing to send', async () => {
    const calls = stubFetch([{ status: 200, body: { ok: true } }]);
    const long = await telegramAdapter.execute(photo({ caption: 'x'.repeat(1_025) }), 't');
    expect(long.error?.code).toBe('telegram_caption_too_long');
    const big = await telegramAdapter.execute(
      photo({ photoBase64: Buffer.concat([png, Buffer.alloc(1_100_000)]).toString('base64') }),
      't',
    );
    expect(big.error?.code).toBe('telegram_invalid_photo');
    expect(calls).toHaveLength(0);
  });

  it('refuses missing input before any request', async () => {
    const calls = stubFetch([{ status: 200, body: { ok: true } }]);
    const result = await telegramAdapter.execute(
      { operation: 'sendPhoto', input: { chatId: '1', caption: 'c' } },
      't',
    );
    expect(result.error?.code).toBe('telegram_invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('reads a refusal as a refusal, final for a bad chat and retried only when told to wait', async () => {
    stubFetch([{ status: 400, body: { ok: false, error_code: 400 } }]);
    const refused = await telegramAdapter.execute(photo(), 't');
    expect(refused.error).toMatchObject({ code: 'telegram_rejected_400', retryable: false });
    const calls = stubFetch([
      { status: 429, body: { ok: false, error_code: 429 } },
      { status: 200, body: { ok: true, result: {} } },
    ]);
    expect(await telegramAdapter.execute(photo(), 't')).toMatchObject({
      status: 'ok',
      attempts: 2,
    });
    expect(calls).toHaveLength(2);
  });

  it('never puts the token in an error', async () => {
    stubFetch([new TypeError('fetch failed for https://api.telegram.org/botSECRET/sendPhoto')]);
    const result = await telegramAdapter.execute(photo(), 'SECRET');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});
