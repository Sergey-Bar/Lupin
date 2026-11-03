import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitHubAdapter, githubAdapter } from './index.js';

/**
 * GitHub Enterprise Server lives at its own origin. The base URL comes from server
 * configuration, never from a request, and the token must never be sent anywhere else.
 */

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function stub(replies: Reply[]) {
  const urls: string[] = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string) => {
    urls.push(url);
    const reply = replies[Math.min(index, replies.length - 1)] as Reply;
    index += 1;
    const status = reply.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(reply.headers ?? {}),
      json: () => Promise.resolve(reply.body ?? {}),
    });
  });
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the API base URL', () => {
  it('defaults to github.com', async () => {
    const urls = stub([{}]);
    await githubAdapter.execute(
      { operation: 'getRepository', input: { owner: 'o', repo: 'r' } },
      'tok',
    );
    expect(urls).toEqual(['https://api.github.com/repos/o/r']);
  });

  it('reads from a GitHub Enterprise Server base, with or without a trailing slash', async () => {
    const urls = stub([{}]);
    const adapter = createGitHubAdapter({ apiBase: 'https://ghe.example.com/api/v3/' });
    await adapter.execute({ operation: 'getRepository', input: { owner: 'o', repo: 'r' } }, 'tok');
    expect(urls).toEqual(['https://ghe.example.com/api/v3/repos/o/r']);
  });

  it.each([
    ['http://ghe.example.com/api/v3', 'plain http would send the token in the clear'],
    ['https://user:secret@ghe.example.com', 'credentials in a URL end up in logs'],
    ['not a url', 'it is not a URL'],
    ['https://ghe.example.com/api/v3?x=1', 'a query string would corrupt every path'],
  ])('refuses %s: %s', (apiBase) => {
    expect(() => createGitHubAdapter({ apiBase })).toThrow(/GitHub API URL/);
  });

  it('follows a next link on its own origin and refuses one on any other', async () => {
    const adapter = createGitHubAdapter({ apiBase: 'https://ghe.example.com/api/v3' });
    const own = 'https://ghe.example.com/api/v3/repos/o/r/issues?page=2';
    const urls = stub([
      { body: [{ number: 1 }], headers: { link: `<${own}>; rel="next"` } },
      { body: [{ number: 2 }] },
    ]);
    const followed = await adapter.execute(
      { operation: 'listPullRequests', input: { owner: 'o', repo: 'r' } },
      'tok',
    );
    expect(followed.status).toBe('ok');
    expect(urls).toHaveLength(2);

    const foreign = stub([
      {
        body: [{ number: 1 }],
        headers: { link: '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"' },
      },
    ]);
    await adapter.execute(
      { operation: 'listPullRequests', input: { owner: 'o', repo: 'r' } },
      'tok',
    );
    expect(foreign).toHaveLength(1);
  });
});

describe('the rate-limit budget', () => {
  it('turns a rate-limited write into a wait with a time, not a permanent 403', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    stub([
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      },
    ]);
    const result = await githubAdapter.execute(
      { operation: 'createIssue', input: { owner: 'o', repo: 'r', title: 't' } },
      'tok',
    );
    expect(result.error).toMatchObject({
      code: 'github_rate_limited',
      retryable: true,
      retryAt: new Date(reset * 1000).toISOString(),
    });
  });

  it('still treats a 403 with budget left as a permission refusal', async () => {
    stub([{ status: 403, headers: { 'x-ratelimit-remaining': '12' } }]);
    const result = await githubAdapter.execute(
      { operation: 'createIssue', input: { owner: 'o', repo: 'r', title: 't' } },
      'tok',
    );
    expect(result.error).toMatchObject({ code: 'github_403', retryable: false });
  });

  const headers = {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4321',
    'x-ratelimit-reset': '1790000000',
  };

  it('is reported on a single read', async () => {
    stub([{ headers }]);
    const result = await githubAdapter.execute(
      { operation: 'getRepository', input: { owner: 'o', repo: 'r' } },
      'tok',
    );
    expect(result.rateLimit).toEqual({
      limit: 5000,
      remaining: 4321,
      resetAt: new Date(1790000000 * 1000).toISOString(),
    });
  });

  it('is reported from the last page of a list', async () => {
    stub([
      {
        body: [{ number: 1 }],
        headers: {
          ...headers,
          link: '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"',
        },
      },
      { body: [], headers: { ...headers, 'x-ratelimit-remaining': '4320' } },
    ]);
    const result = await githubAdapter.execute(
      { operation: 'listPullRequests', input: { owner: 'o', repo: 'r' } },
      'tok',
    );
    expect(result.rateLimit?.remaining).toBe(4320);
  });

  it('is absent, not zero, when GitHub sends no budget headers', async () => {
    stub([{}]);
    const result = await githubAdapter.execute(
      { operation: 'getRepository', input: { owner: 'o', repo: 'r' } },
      'tok',
    );
    expect(result.rateLimit).toBeUndefined();
  });
});
