import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubAdapter } from './index.js';

/**
 * The writes a person makes from the command center. Each is a closed set of fields: the
 * adapter sends only what the operation declares, so a caller cannot smuggle a field into a
 * merge or a review, and a path parameter cannot escape its segment.
 */

interface Sent {
  url: string;
  method: string | undefined;
  body: unknown;
}

function stub(
  replies: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }> = [{}],
) {
  const sent: Sent[] = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    sent.push({
      url,
      method: init?.method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = replies[Math.min(index, replies.length - 1)] ?? {};
    index += 1;
    const status = reply.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(reply.headers ?? {}),
      json: () => Promise.resolve(reply.body ?? {}),
    });
  });
  return sent;
}

const B = 'https://api.github.com/repos/o/r';
const run = (operation: string, input: Record<string, unknown>) =>
  githubAdapter.execute({ operation, input: { owner: 'o', repo: 'r', ...input } }, 'tok');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the writes are declared honestly', () => {
  it('declares every one as side-effecting, and only the repeatable ones as idempotent', () => {
    const idempotent = [
      'updateIssue',
      'requestReviewers',
      'updatePullRequestBranch',
      'updateBranchProtection',
    ];
    const once = ['createPullRequestReview', 'mergePullRequest', 'rerunWorkflow', 'createRelease'];
    for (const name of idempotent) {
      expect(githubAdapter.manifest.operations[name], name).toMatchObject({
        sideEffecting: true,
        idempotent: true,
      });
    }
    // A merge, a review, a re-run and a release must never be retried after a 5xx: the first
    // attempt may have happened.
    for (const name of once) {
      expect(githubAdapter.manifest.operations[name], name).toMatchObject({
        sideEffecting: true,
        idempotent: false,
      });
    }
  });
});

describe('what each write sends', () => {
  it('updates an issue or pull request: state, labels and assignees only', async () => {
    const sent = stub();
    await run('updateIssue', {
      number: '7',
      state: 'closed',
      labels: ['bug', 'p1'],
      assignees: [],
      title: 'must not pass',
      owner_override: 'x',
    });
    expect(sent[0]).toEqual({
      url: `${B}/issues/7`,
      method: 'PATCH',
      body: { state: 'closed', labels: ['bug', 'p1'], assignees: [] },
    });
  });

  it('requests reviewers', async () => {
    const sent = stub();
    await run('requestReviewers', { number: '7', reviewers: ['amy', 'bob'] });
    expect(sent[0]).toEqual({
      url: `${B}/pulls/7/requested_reviewers`,
      method: 'POST',
      body: { reviewers: ['amy', 'bob'] },
    });
  });

  it('submits a review on the commit the person looked at', async () => {
    const sent = stub();
    await run('createPullRequestReview', {
      number: '7',
      event: 'APPROVE',
      body: 'Looks good',
      commit_id: 'abcdef1',
    });
    expect(sent[0]).toEqual({
      url: `${B}/pulls/7/reviews`,
      method: 'POST',
      body: { event: 'APPROVE', body: 'Looks good', commit_id: 'abcdef1' },
    });
  });

  it('merges only the head commit the caller named, by the method asked for', async () => {
    const sent = stub();
    await run('mergePullRequest', { number: '7', sha: 'abcdef1', merge_method: 'squash' });
    expect(sent[0]).toEqual({
      url: `${B}/pulls/7/merge`,
      method: 'PUT',
      body: { sha: 'abcdef1', merge_method: 'squash' },
    });
  });

  it('refuses a merge with no sha before it sends anything', async () => {
    const sent = stub();
    const result = await run('mergePullRequest', { number: '7' });
    expect(result.error?.code).toBe('github_invalid_input');
    expect(sent).toHaveLength(0);
  });

  it('updates a branch only if it is still at the sha the caller saw', async () => {
    const sent = stub();
    await run('updatePullRequestBranch', { number: '7', expected_head_sha: 'abcdef1' });
    expect(sent[0]).toEqual({
      url: `${B}/pulls/7/update-branch`,
      method: 'PUT',
      body: { expected_head_sha: 'abcdef1' },
    });
  });

  it('re-runs a workflow run, with no body', async () => {
    const sent = stub();
    await run('rerunWorkflow', { runId: '123' });
    expect(sent[0]).toEqual({ url: `${B}/actions/runs/123/rerun`, method: 'POST', body: {} });
  });

  it('creates a release, keeping an explicit false', async () => {
    const sent = stub();
    await run('createRelease', {
      tag_name: 'v1.2.0',
      name: 'v1.2.0',
      body: 'Notes',
      draft: false,
      prerelease: true,
    });
    expect(sent[0]).toEqual({
      url: `${B}/releases`,
      method: 'POST',
      body: { tag_name: 'v1.2.0', name: 'v1.2.0', body: 'Notes', draft: false, prerelease: true },
    });
  });

  it('sets branch protection from a whole body, keeping the nulls GitHub requires', async () => {
    const sent = stub();
    const protection = {
      required_status_checks: null,
      enforce_admins: false,
      required_pull_request_reviews: { required_approving_review_count: 1 },
      restrictions: null,
    };
    await run('updateBranchProtection', { branch: 'release/1.0', protection });
    expect(sent[0]).toEqual({
      url: `${B}/branches/release%2F1.0/protection`,
      method: 'PUT',
      body: protection,
    });
  });

  it('refuses protection that is not an object', async () => {
    const sent = stub();
    for (const protection of [undefined, null, [], 'x']) {
      const result = await run('updateBranchProtection', { branch: 'main', protection });
      expect(result.error?.code).toBe('github_invalid_input');
    }
    expect(sent).toHaveLength(0);
  });
});

describe('what happens when GitHub says no', () => {
  it('reports a merge GitHub refuses as a rejection, not a retry', async () => {
    const sent = stub([{ status: 409, body: { message: 'Head branch was modified' } }]);
    const result = await run('mergePullRequest', { number: '7', sha: 'abcdef1' });
    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'github_409', retryable: false },
      attempts: 1,
    });
    expect(sent).toHaveLength(1);
  });

  it('does not retry a merge after a server error, because it may have happened', async () => {
    const sent = stub([{ status: 502 }, { status: 200 }]);
    const result = await run('mergePullRequest', { number: '7', sha: 'abcdef1' });
    expect(result.status).toBe('error');
    expect(sent).toHaveLength(1);
  });

  it('does retry a repeatable write after a server error', async () => {
    vi.useFakeTimers();
    try {
      const sent = stub([{ status: 502 }, { status: 200 }]);
      const pending = run('updateIssue', { number: '7', state: 'open' });
      await vi.runAllTimersAsync();
      expect((await pending).status).toBe('ok');
      expect(sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('encodes a number so it cannot leave its path segment', async () => {
    const sent = stub();
    await run('updateIssue', { number: '7/../../x', state: 'closed' });
    expect(sent[0]?.url).toBe(`${B}/issues/7%2F..%2F..%2Fx`);
  });
});
