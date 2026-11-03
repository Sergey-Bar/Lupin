import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailAdapter } from './index.js';

type Reply = { status: number; body?: unknown } | Error;

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

const BRIDGE = 'http://mail-bridge:8025';
const send = {
  operation: 'send',
  input: {
    from: 'lupin@example.com',
    to: 'qa@example.com, lead@example.com',
    subject: 'Daily quality report',
    text: '🟢 all good',
    html: '<p>🟢 all good</p>',
  },
};

describe('email adapter', () => {
  it('sends through the bridge, splitting recipients and carrying the HTML', async () => {
    const calls = stubFetch([{ status: 202, body: { id: 'm-1' } }]);
    const result = await emailAdapter.execute(send, `${BRIDGE}/`);
    expect(result).toEqual({ status: 'ok', data: { id: 'm-1' }, attempts: 1 });
    expect(calls[0]?.url).toBe('http://mail-bridge:8025/send');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      from: 'lupin@example.com',
      to: ['qa@example.com', 'lead@example.com'],
      subject: 'Daily quality report',
      text: '🟢 all good',
      html: '<p>🟢 all good</p>',
    });
  });

  it('omits html for a digest-format email that carries only text', async () => {
    const calls = stubFetch([{ status: 200, body: {} }]);
    await emailAdapter.execute(
      { operation: 'send', input: { from: 'a@x', to: 'b@x', subject: 's', text: 'plain' } },
      BRIDGE,
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty('html');
  });

  it('checks the bridge with GET /about, and accepts an empty body', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const result = await emailAdapter.execute({ operation: 'about', input: {} }, BRIDGE);
    expect(result).toEqual({ status: 'ok', data: {}, attempts: 1 });
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('retries a 429 the bridge refused, and not a 500 after a send', async () => {
    const limited = stubFetch([
      { status: 429, body: {} },
      { status: 202, body: {} },
    ]);
    expect(await emailAdapter.execute(send, BRIDGE)).toMatchObject({ status: 'ok', attempts: 2 });
    expect(limited).toHaveLength(2);
    const failed = stubFetch([{ status: 500, body: {} }]);
    expect((await emailAdapter.execute(send, BRIDGE)).error?.code).toBe('email_500');
    expect(failed).toHaveLength(1);
  });

  it('treats a rejected recipient as final', async () => {
    stubFetch([{ status: 422, body: { error: 'invalid recipient' } }]);
    expect((await emailAdapter.execute(send, BRIDGE)).error).toMatchObject({
      code: 'email_rejected_422',
      retryable: false,
    });
  });

  it('refuses a bridge that is not http(s), carries credentials, or is not a URL', async () => {
    const calls = stubFetch([{ status: 202, body: {} }]);
    for (const secret of ['ftp://x', 'http://u:p@x', 'nowhere']) {
      expect((await emailAdapter.execute(send, secret)).error?.code).toBe('email_invalid_bridge');
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses a send with no recipient or a missing field', async () => {
    const calls = stubFetch([{ status: 202, body: {} }]);
    expect(
      (
        await emailAdapter.execute(
          { operation: 'send', input: { from: 'a@x', to: '  ,  ', subject: 's', text: 't' } },
          BRIDGE,
        )
      ).error?.code,
    ).toBe('email_invalid_input');
    expect(
      (
        await emailAdapter.execute(
          { operation: 'send', input: { from: 'a@x', to: 'b@x', text: 't' } },
          BRIDGE,
        )
      ).error?.code,
    ).toBe('email_invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('reports a bridge that is down as a transport failure', async () => {
    stubFetch([new TypeError('connect ECONNREFUSED')]);
    expect((await emailAdapter.execute(send, BRIDGE)).error?.code).toBe('email_transport_failed');
  });
});
