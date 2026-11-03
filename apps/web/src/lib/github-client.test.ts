import { describe, expect, it } from 'vitest';
import { createGithubClient } from './github-client.js';

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const impl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { impl, calls };
}

describe('the GitHub client', () => {
  it('asks for pull requests with only the filters that were set', async () => {
    const { impl, calls } = fakeFetch({ items: [], nextCursor: null });
    await createGithubClient('', impl).listPulls({
      state: 'open',
      projectId: 'p 1',
      author: undefined,
      limit: 25,
    });
    expect(calls[0]?.url).toBe('/api/v1/github/prs?state=open&projectId=p+1&limit=25');
    expect(calls[0]?.init).toMatchObject({ method: 'GET', credentials: 'include' });
  });

  it('passes a cursor through for the next page', async () => {
    const { impl, calls } = fakeFetch({ items: [], nextCursor: null });
    await createGithubClient('', impl).listIssues({ state: 'all', cursor: 'abc' });
    expect(calls[0]?.url).toBe('/api/v1/github/issues?state=all&cursor=abc');
  });

  it('refuses an answer that is not the contract, rather than drawing it', async () => {
    const { impl } = fakeFetch({ items: [{ nope: true }], nextCursor: null });
    await expect(createGithubClient('', impl).listPulls({ state: 'open' })).rejects.toThrow();
  });

  it('reads one repository by id, encoded', async () => {
    const { impl, calls } = fakeFetch({ items: [] });
    await createGithubClient('', impl).listRepos();
    expect(calls[0]?.url).toBe('/api/v1/github/repos');
  });
});
