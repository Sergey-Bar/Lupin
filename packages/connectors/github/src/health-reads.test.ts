import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubAdapter } from './index.js';

/**
 * The reads a repository-health view is built from: pull request detail, issues, labels,
 * branches, branch protection, checks, the three alert feeds and the community profile.
 *
 * Alerts and protection are the ones a token may simply not be allowed to see. That is a
 * state the caller must be able to tell apart from "there are none", so it is returned as data
 * (`unavailable`) rather than as a failure that would abort a whole sync.
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
      json: () => Promise.resolve(reply.body ?? []),
    });
  });
  return urls;
}

const B = 'https://api.github.com/repos/o/r';
const PAGING = 'per_page=100&page=1';
const run = (operation: string, input: Record<string, unknown> = {}) =>
  githubAdapter.execute({ operation, input: { owner: 'o', repo: 'r', ...input } }, 'tok');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the health reads are declared as reads', () => {
  it('declares every one as not side-effecting and idempotent', () => {
    for (const name of [
      'getPullRequest',
      'listIssues',
      'listLabels',
      'listBranches',
      'getBranchProtection',
      'listCheckRuns',
      'listDependabotAlerts',
      'listCodeScanningAlerts',
      'listSecretScanningAlerts',
      'getCommunityProfile',
    ]) {
      expect(githubAdapter.manifest.operations[name], name).toMatchObject({
        sideEffecting: false,
        idempotent: true,
      });
    }
  });
});

describe('where each read goes', () => {
  it.each([
    ['getPullRequest', { number: '7' }, `${B}/pulls/7`],
    ['listIssues', {}, `${B}/issues?state=all&sort=updated&direction=desc&${PAGING}`],
    ['listLabels', {}, `${B}/labels?${PAGING}`],
    ['listBranches', {}, `${B}/branches?${PAGING}`],
    ['getBranchProtection', { branch: 'main' }, `${B}/branches/main/protection`],
    ['getBranchProtection', { branch: 'release/1.0' }, `${B}/branches/release%2F1.0/protection`],
    ['listCheckRuns', { ref: 'abc123' }, `${B}/commits/abc123/check-runs?${PAGING}`],
    // Dependabot alerts are cursor-paged: GitHub answers 400 to a `page` parameter (found live).
    ['listDependabotAlerts', {}, `${B}/dependabot/alerts?state=open&per_page=100`],
    ['listCodeScanningAlerts', {}, `${B}/code-scanning/alerts?state=open&${PAGING}`],
    ['listSecretScanningAlerts', {}, `${B}/secret-scanning/alerts?state=open&${PAGING}`],
    ['getCommunityProfile', {}, `${B}/community/profile`],
  ])('%s %j', async (operation, input, url) => {
    const urls = stub([{}]);
    const result = await run(operation, input);
    expect(result.status).toBe('ok');
    expect(urls[0]).toBe(url);
  });

  it('refuses a path parameter that is missing before it sends anything', async () => {
    const urls = stub([{}]);
    const result = await run('getBranchProtection');
    expect(result.error?.code).toBe('github_invalid_input');
    expect(urls).toHaveLength(0);
  });
});

describe('listIssues', () => {
  it('can be asked for open issues only, which is how the backlog is read', async () => {
    const urls = stub([{ body: [] }]);
    await run('listIssues', { state: 'open' });
    expect(urls[0]).toBe(`${B}/issues?state=open&sort=updated&direction=desc&${PAGING}`);
  });

  it('can list only open pull requests the same way', async () => {
    const urls = stub([{ body: [] }]);
    await run('listPullRequests', { state: 'open' });
    expect(urls[0]).toBe(`${B}/pulls?state=open&sort=updated&direction=desc&${PAGING}`);
  });

  it('drops pull requests, which GitHub lists among issues, and keeps the walk going', async () => {
    stub([
      {
        body: [{ number: 1 }, { number: 2, pull_request: { url: 'x' } }, { number: 3 }],
        headers: { link: `<${B}/issues?page=2>; rel="next"` },
      },
      { body: [{ number: 4, pull_request: {} }, { number: 5 }] },
    ]);
    const result = await run('listIssues');
    expect(result.data).toEqual({
      items: [{ number: 1 }, { number: 3 }, { number: 5 }],
      pages: 2,
      nextPage: null,
    });
  });
});

describe('listCheckRuns', () => {
  it('reads the runs out of the check_runs wrapper', async () => {
    stub([{ body: { total_count: 2, check_runs: [{ name: 'a' }, { name: 'b' }] } }]);
    const result = await run('listCheckRuns', { ref: 'abc' });
    expect(result.data).toEqual({
      items: [{ name: 'a' }, { name: 'b' }],
      pages: 1,
      nextPage: null,
    });
  });
});

describe('a feed the token may not be allowed to see', () => {
  it.each([
    [403, 'forbidden'],
    [404, 'not_found'],
  ])(
    'answers %i as unavailable (%s), not as a failure and not as an empty list',
    async (status, reason) => {
      stub([{ status, body: { message: 'Resource not accessible by integration' } }]);
      const result = await run('listDependabotAlerts');
      expect(result).toMatchObject({
        status: 'ok',
        data: { items: [], pages: 0, nextPage: null, unavailable: reason },
      });
    },
  );

  it('keeps GitHub’s own reason, so an unprotected branch is not mistaken for no access', async () => {
    stub([{ status: 404, body: { message: 'Branch not protected' } }]);
    const result = await run('getBranchProtection', { branch: 'main' });
    expect(result).toMatchObject({
      status: 'ok',
      data: { unavailable: 'not_found', message: 'Branch not protected' },
    });
  });

  it('still reports a rate limit as a wait, because a 403 at the limit is not a permission', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    stub([
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      },
    ]);
    const result = await run('listCodeScanningAlerts');
    expect(result.error?.code).toBe('github_rate_limited');
  });

  it('does not soften any other status, or a read that is not an alert feed', async () => {
    stub([{ status: 500 }]);
    expect((await run('listSecretScanningAlerts')).status).toBe('error');
    stub([{ status: 404 }]);
    expect((await run('getPullRequest', { number: '9' })).status).toBe('error');
  });
});

describe('a cursor-paged feed (Dependabot alerts)', () => {
  it('never sends a page number, because GitHub rejects it', async () => {
    const urls = stub([{}]);
    await run('listDependabotAlerts', { page: 3, perPage: 50 });
    expect(urls[0]).toBe(`${B}/dependabot/alerts?state=open&per_page=50`);
    expect(new URL(urls[0] as string).searchParams.has('page')).toBe(false);
  });

  it('still says there is more to read when GitHub links a next cursor', async () => {
    const cursor = `${B}/dependabot/alerts?state=open&per_page=1&after=Y3Vyc29y`;
    stub([{ body: [{ number: 1 }], headers: { link: `<${cursor}>; rel="next"` } }]);
    const result = await run('listDependabotAlerts', { maxPages: 1 });
    expect(result.data).toMatchObject({ items: [{ number: 1 }], pages: 1 });
    // A number would be meaningless here; it is only the signal that the list was cut short.
    expect((result.data as { nextPage: number | null }).nextPage).not.toBeNull();
  });

  it('follows the cursor link when asked for more pages', async () => {
    const cursor = `${B}/dependabot/alerts?state=open&per_page=1&after=Y3Vyc29y`;
    const urls = stub([
      { body: [{ number: 1 }], headers: { link: `<${cursor}>; rel="next"` } },
      { body: [{ number: 2 }] },
    ]);
    const result = await run('listDependabotAlerts', { maxPages: 2 });
    expect(urls[1]).toBe(cursor);
    expect(result.data).toEqual({
      items: [{ number: 1 }, { number: 2 }],
      pages: 2,
      nextPage: null,
    });
  });
});
