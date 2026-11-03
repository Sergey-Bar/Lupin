import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@lupin/db';
import type { GithubActionRequest } from '@lupin/shared-contracts';
import type { ConnectorAdapter, ConnectorRequest, ConnectorResult } from '@lupin/connectors-sdk';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { runGithubActions } from './github-actions-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-23T12:00:00.000Z');
const TOKEN = ['ghp', 'synthetic', 'token'].join('_');

type Reply = ConnectorResult | ((request: ConnectorRequest) => ConnectorResult);
const ok: ConnectorResult = { status: 'ok', data: {}, attempts: 1 };
const failure = (status: number, retryAt?: string): ConnectorResult => ({
  status: 'error',
  error: {
    code: retryAt === undefined ? `github_${String(status)}` : 'github_rate_limited',
    retryable: retryAt !== undefined,
    message: 'GitHub operation failed',
    ...(retryAt === undefined ? {} : { retryAt }),
  },
  attempts: 1,
});

function fakeAdapter(replies: Record<string, Reply> = {}) {
  const calls: ConnectorRequest[] = [];
  const secrets: string[] = [];
  const adapter: ConnectorAdapter = {
    manifest: { name: 'github', version: '1', operations: {} },
    execute: vi.fn(async (request: ConnectorRequest, secret: string) => {
      calls.push(request);
      secrets.push(secret);
      const reply = replies[request.operation] ?? ok;
      return typeof reply === 'function' ? reply(request) : reply;
    }),
  };
  return { adapter, calls, secrets };
}

async function setup(
  options: {
    replies?: Record<string, Reply>;
    token?: string | null;
    repositoryUrl?: string | null;
  } = {},
) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const project = async (workspaceId: string, url: string | null) => {
    const [row] = await db
      .insert(schema.projects)
      .values({ workspaceId, name: 'P', slug: `p-${workspaceId}`, repositoryUrl: url })
      .returning({ id: schema.projects.id });
    return (row as { id: string }).id;
  };
  const mine = await project(
    'ws-1',
    options.repositoryUrl === undefined ? 'https://github.com/octo/service' : options.repositoryUrl,
  );
  const foreign = await project('ws-2', 'https://github.com/other/foreign');
  const fake = fakeAdapter(options.replies);
  const run = (actions: GithubActionRequest[], dryRun = false) =>
    runGithubActions(
      {
        db: db as never,
        workspaceId: 'ws-1',
        adapter: fake.adapter,
        tokenFor: async () => (options.token === undefined ? TOKEN : options.token),
        now: () => NOW,
      },
      'token:operator',
      { dryRun, actions },
    );
  const seedPull = (values: Partial<typeof schema.pullRequests.$inferInsert> = {}) =>
    db.insert(schema.pullRequests).values({
      workspaceId: 'ws-1',
      projectId: mine,
      externalId: 'pr-7',
      number: 7,
      state: 'open',
      title: 'Change',
      openedAt: NOW,
      lastActivityAt: NOW,
      ...values,
    });
  const seedIssue = (values: Partial<typeof schema.githubIssues.$inferInsert> = {}) =>
    db.insert(schema.githubIssues).values({
      workspaceId: 'ws-1',
      projectId: mine,
      externalId: 'is-9',
      number: 9,
      state: 'open',
      title: 'Issue',
      openedAt: NOW,
      lastActivityAt: NOW,
      ...values,
    });
  const audits = async () =>
    (await db.select().from(schema.auditEvents)).filter((row) => row.action.startsWith('github.'));
  return { db, mine, foreign, run, seedPull, seedIssue, audits, ...fake };
}

describe('runGithubActions', () => {
  it('comments with the project’s token, and records who did it without the text or the token', async () => {
    const t = await setup();
    const { results } = await t.run([
      { action: 'comment', projectId: t.mine, number: 9, body: 'Please add a repro.' },
    ]);
    expect(results).toEqual([
      {
        action: 'comment',
        target: 'octo/service#9',
        outcome: 'ok',
        message: 'Done.',
        retryAt: null,
      },
    ]);
    expect(t.calls[0]).toEqual({
      operation: 'createIssueComment',
      input: { owner: 'octo', repo: 'service', number: '9', body: 'Please add a repro.' },
    });
    expect(t.secrets).toEqual([TOKEN]);

    const [entry] = await t.audits();
    expect(entry).toMatchObject({
      actorId: 'token:operator',
      action: 'github.comment',
      resourceType: 'project',
      resourceId: t.mine,
      workspaceId: 'ws-1',
    });
    expect(entry?.details).toMatchObject({
      target: 'octo/service#9',
      outcome: 'ok',
      dryRun: false,
    });
    const everything = JSON.stringify({ results, details: entry?.details });
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('Please add a repro');
  });

  it('on a dry run makes no GitHub call, says what it would do, and still checks the token exists', async () => {
    const t = await setup();
    const planned = await t.run(
      [{ action: 'merge', projectId: t.mine, number: 7, sha: 'abcdef1', method: 'squash' }],
      true,
    );
    expect(t.calls).toHaveLength(0);
    expect(planned.dryRun).toBe(true);
    expect(planned.results[0]).toMatchObject({
      outcome: 'planned',
      message: expect.stringContaining('squash'),
    });
    expect((await t.audits())[0]?.details).toMatchObject({ outcome: 'planned', dryRun: true });

    const noToken = await setup({ token: null });
    const refused = await noToken.run(
      [{ action: 'close', projectId: noToken.mine, number: 7 }],
      true,
    );
    expect(refused.results[0]?.outcome).toBe('refused');
  });

  describe('merge', () => {
    const merge = (projectId: string): GithubActionRequest => ({
      action: 'merge',
      projectId,
      number: 7,
      sha: 'abcdef1',
      method: 'rebase',
    });

    it('sends the sha and method, and marks the stored pull request merged', async () => {
      const t = await setup();
      await t.seedPull();
      const { results } = await t.run([merge(t.mine)]);
      expect(results[0]?.outcome).toBe('ok');
      expect(t.calls[0]).toEqual({
        operation: 'mergePullRequest',
        input: {
          owner: 'octo',
          repo: 'service',
          number: '7',
          sha: 'abcdef1',
          merge_method: 'rebase',
        },
      });
      const [row] = await t.db.select().from(schema.pullRequests);
      expect(row).toMatchObject({ state: 'merged', mergedAt: NOW });
    });

    it('refuses, and leaves the stored pull request alone, when the branch moved since the person looked', async () => {
      const t = await setup({ replies: { mergePullRequest: failure(409) } });
      await t.seedPull();
      const { results } = await t.run([merge(t.mine)]);
      expect(results[0]).toMatchObject({
        outcome: 'refused',
        message: expect.stringContaining('changed after you looked'),
      });
      expect((await t.db.select().from(schema.pullRequests))[0]?.state).toBe('open');
      expect((await t.audits())[0]?.details).toMatchObject({ outcome: 'refused' });
    });

    it('explains a merge GitHub will not allow, and a token that may not merge', async () => {
      const blocked = await setup({ replies: { mergePullRequest: failure(405) } });
      expect((await blocked.run([merge(blocked.mine)])).results[0]).toMatchObject({
        outcome: 'refused',
        message: expect.stringContaining('cannot be merged'),
      });
      const forbidden = await setup({ replies: { mergePullRequest: failure(403) } });
      expect((await forbidden.run([merge(forbidden.mine)])).results[0]).toMatchObject({
        outcome: 'failed',
        message: expect.stringContaining('token'),
      });
    });

    it('does not even ask GitHub to merge what is already merged, closed or a draft', async () => {
      for (const values of [{ state: 'merged' }, { state: 'closed' }, { draft: true }] as const) {
        const t = await setup();
        await t.seedPull(values);
        const { results } = await t.run([merge(t.mine)]);
        expect(results[0]?.outcome, JSON.stringify(values)).toBe('refused');
        expect(t.calls).toHaveLength(0);
      }
    });
  });

  it('keeps the stored copy in step with what it just did', async () => {
    const t = await setup();
    await t.seedPull();
    await t.seedIssue();
    await t.run([
      { action: 'labels', projectId: t.mine, number: 9, labels: ['bug', 'p1'] },
      { action: 'assign', projectId: t.mine, number: 9, assignees: ['amy'] },
      { action: 'close', projectId: t.mine, number: 9 },
      { action: 'close', projectId: t.mine, number: 7 },
      { action: 'requestReviewers', projectId: t.mine, number: 7, reviewers: ['bob'] },
    ]);
    const [issue] = await t.db.select().from(schema.githubIssues);
    expect(issue).toMatchObject({ labels: ['bug', 'p1'], assignees: ['amy'], state: 'closed' });
    const [pr] = await t.db.select().from(schema.pullRequests);
    expect(pr).toMatchObject({ state: 'closed', requestedReviewers: ['bob'] });
    expect(t.calls.map((call) => call.operation)).toEqual([
      'updateIssue',
      'updateIssue',
      'updateIssue',
      'updateIssue',
      'requestReviewers',
    ]);
    expect(t.calls[2]?.input).toMatchObject({ state: 'closed' });
  });

  it('reopens, reviews, updates a branch and re-runs a workflow', async () => {
    const t = await setup();
    await t.run([
      { action: 'reopen', projectId: t.mine, number: 7 },
      { action: 'review', projectId: t.mine, number: 7, event: 'APPROVE', body: 'LGTM' },
      { action: 'updateBranch', projectId: t.mine, number: 7, sha: 'abcdef1' },
      { action: 'rerunWorkflow', projectId: t.mine, runId: '555' },
    ]);
    expect(t.calls.map((call) => [call.operation, call.input])).toEqual([
      ['updateIssue', { owner: 'octo', repo: 'service', number: '7', state: 'open' }],
      [
        'createPullRequestReview',
        { owner: 'octo', repo: 'service', number: '7', event: 'APPROVE', body: 'LGTM' },
      ],
      [
        'updatePullRequestBranch',
        { owner: 'octo', repo: 'service', number: '7', expected_head_sha: 'abcdef1' },
      ],
      ['rerunWorkflow', { owner: 'octo', repo: 'service', runId: '555' }],
    ]);
  });

  describe('refusals, before anything is sent', () => {
    it('refuses another workspace’s project as if it did not exist', async () => {
      const t = await setup();
      const { results } = await t.run([{ action: 'close', projectId: t.foreign, number: 1 }]);
      expect(results[0]).toMatchObject({
        outcome: 'refused',
        message: expect.stringContaining('project'),
      });
      expect(t.calls).toHaveLength(0);
      // The refusal is recorded against the caller's own workspace.
      expect((await t.audits())[0]?.workspaceId).toBe('ws-1');
    });

    it('refuses a project that is not a GitHub repository, and a project with no token', async () => {
      const local = await setup({ repositoryUrl: null });
      expect(
        (await local.run([{ action: 'close', projectId: local.mine, number: 1 }])).results[0],
      ).toMatchObject({
        outcome: 'refused',
        message: expect.stringContaining('GitHub repository'),
      });
      const noToken = await setup({ token: null });
      expect(
        (await noToken.run([{ action: 'close', projectId: noToken.mine, number: 1 }])).results[0],
      ).toMatchObject({
        outcome: 'refused',
        message: expect.stringContaining('token'),
      });
      expect(local.calls).toHaveLength(0);
      expect(noToken.calls).toHaveLength(0);
    });
  });

  describe('many at once', () => {
    it('reports each item on its own, so one failure does not hide the rest', async () => {
      let n = 0;
      const t = await setup({
        replies: { updateIssue: () => (++n === 2 ? failure(404) : ok) },
      });
      const { results } = await t.run(
        [1, 2, 3].map((number) => ({ action: 'close' as const, projectId: t.mine, number })),
      );
      expect(results.map((r) => r.outcome)).toEqual(['ok', 'failed', 'ok']);
      expect(results[1]?.message).toContain('not found');
      expect(await t.audits()).toHaveLength(3);
    });

    it('stops at a rate limit, tells the caller when to come back, and does not hammer GitHub', async () => {
      const reset = '2026-10-23T13:00:00.000Z';
      const t = await setup({ replies: { updateIssue: failure(403, reset) } });
      const { results } = await t.run(
        [1, 2, 3].map((number) => ({ action: 'close' as const, projectId: t.mine, number })),
      );
      expect(t.calls).toHaveLength(1);
      expect(results.map((r) => r.outcome)).toEqual(['failed', 'failed', 'failed']);
      expect(results.every((r) => r.retryAt === reset)).toBe(true);
      expect(results[2]?.message).toContain('Skipped');
    });
  });

  it('writes audit rows only for its own workspace', async () => {
    const t = await setup();
    await t.run([{ action: 'close', projectId: t.mine, number: 1 }]);
    const rows = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.workspaceId, 'ws-2'));
    expect(rows).toEqual([]);
  });
});

describe('repository actions', () => {
  const UNPROTECTED: ConnectorResult = {
    status: 'ok',
    data: { unavailable: 'not_found', message: 'Branch not protected' },
    attempts: 1,
  };
  const PROTECTED: ConnectorResult = {
    status: 'ok',
    data: { required_pull_request_reviews: { required_approving_review_count: 2 } },
    attempts: 1,
  };
  const protect = (projectId: string): GithubActionRequest => ({
    action: 'protectBranch',
    projectId,
  });

  it('requires one approving review on a branch that has no protection', async () => {
    const t = await setup({ replies: { getBranchProtection: UNPROTECTED } });
    const { results } = await t.run([protect(t.mine)]);
    expect(results[0]).toMatchObject({ outcome: 'ok', target: 'octo/service@main' });
    expect(t.calls.map((call) => call.operation)).toEqual([
      'getBranchProtection',
      'updateBranchProtection',
    ]);
    expect(t.calls[1]?.input).toEqual({
      owner: 'octo',
      repo: 'service',
      branch: 'main',
      protection: {
        required_status_checks: null,
        enforce_admins: false,
        required_pull_request_reviews: { required_approving_review_count: 1 },
        restrictions: null,
      },
    });
  });

  it('never replaces protection that already exists: a PUT would overwrite a stronger rule', async () => {
    const t = await setup({ replies: { getBranchProtection: PROTECTED } });
    const { results } = await t.run([protect(t.mine)]);
    expect(results[0]).toMatchObject({
      outcome: 'refused',
      message: expect.stringContaining('already protected'),
    });
    expect(t.calls.map((call) => call.operation)).toEqual(['getBranchProtection']);
  });

  it('refuses to guess when it cannot read what protection exists', async () => {
    for (const reply of [
      { status: 'ok', data: { unavailable: 'forbidden' }, attempts: 1 } as ConnectorResult,
      {
        status: 'ok',
        data: { unavailable: 'not_found', message: 'Not Found' },
        attempts: 1,
      } as ConnectorResult,
    ]) {
      const t = await setup({ replies: { getBranchProtection: reply } });
      const { results } = await t.run([protect(t.mine)]);
      expect(results[0]?.outcome).toBe('refused');
      expect(results[0]?.message).toContain('cannot read');
      expect(t.calls).toHaveLength(1);
    }
  });

  it('reports a failed read as a failure, and never writes after it', async () => {
    const t = await setup({ replies: { getBranchProtection: failure(500) } });
    const { results } = await t.run([protect(t.mine)]);
    expect(results[0]?.outcome).toBe('failed');
    expect(t.calls.map((call) => call.operation)).toEqual(['getBranchProtection']);
  });

  it('on a dry run says what it would do and asks GitHub for nothing', async () => {
    const t = await setup();
    const { results } = await t.run([protect(t.mine)], true);
    expect(results[0]).toMatchObject({
      outcome: 'planned',
      message: expect.stringContaining('unless it is already protected'),
    });
    expect(t.calls).toHaveLength(0);
  });

  it('creates a release, and records the tag and not the notes', async () => {
    const t = await setup();
    const { results } = await t.run([
      {
        action: 'createRelease',
        projectId: t.mine,
        tag: 'v1.2.0',
        name: 'Version 1.2',
        notes: 'Private release notes',
        draft: false,
        prerelease: true,
      },
    ]);
    expect(results[0]).toMatchObject({ outcome: 'ok', target: 'octo/service release v1.2.0' });
    expect(t.calls[0]).toEqual({
      operation: 'createRelease',
      input: {
        owner: 'octo',
        repo: 'service',
        tag_name: 'v1.2.0',
        name: 'Version 1.2',
        body: 'Private release notes',
        draft: false,
        prerelease: true,
      },
    });
    const details = JSON.stringify((await t.audits()).map((entry) => entry.details));
    expect(details).toContain('v1.2.0');
    expect(details).not.toContain('Private release notes');
  });

  it('refuses a release GitHub rejects, for instance a tag that already exists', async () => {
    const t = await setup({ replies: { createRelease: failure(422) } });
    const { results } = await t.run([
      { action: 'createRelease', projectId: t.mine, tag: 'v1', draft: false, prerelease: false },
    ]);
    expect(results[0]).toMatchObject({
      outcome: 'refused',
      message: 'GitHub rejected the request.',
    });
  });
});
