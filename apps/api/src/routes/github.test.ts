import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import * as schema from '@lupin/db';
import {
  GithubActionsResponseSchema,
  GithubIssuePageSchema,
  GithubPullPageSchema,
  GithubRepoItemSchema,
  GithubRepoListSchema,
} from '@lupin/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { createGitHubActionRoutes, createGitHubReadRoutes } from './github.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-23T12:00:00.000Z');

async function harness() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const project = async (workspaceId: string, name: string, url: string) => {
    const [row] = await db
      .insert(schema.projects)
      .values({ workspaceId, name, slug: name.toLowerCase(), repositoryUrl: url })
      .returning({ id: schema.projects.id });
    return (row as { id: string }).id;
  };
  const mine = await project('ws-1', 'Service', 'https://github.com/octo/service');
  const theirs = await project('ws-2', 'Foreign', 'https://github.com/other/foreign');
  await db.insert(schema.pullRequests).values([
    {
      workspaceId: 'ws-1',
      projectId: mine,
      externalId: '1',
      number: 1,
      state: 'open',
      title: 'Mine',
      authorLogin: 'amy',
      openedAt: NOW,
      lastActivityAt: NOW,
    },
    {
      workspaceId: 'ws-2',
      projectId: theirs,
      externalId: '2',
      number: 2,
      state: 'open',
      title: 'Theirs',
      openedAt: NOW,
      lastActivityAt: NOW,
    },
  ]);
  await db.insert(schema.githubIssues).values({
    workspaceId: 'ws-1',
    projectId: mine,
    externalId: '9',
    number: 9,
    state: 'open',
    title: 'An issue',
    openedAt: NOW,
    lastActivityAt: NOW,
  });
  const tokens: Record<string, Caller> = {
    lup_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
    lup_operator: { actor: 'token:operator', role: 'operator', uploaderFor: null },
    lup_uploader: { actor: 'token:uploader', role: null, uploaderFor: mine },
  };
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => tokens[token] ?? null,
    hasSession: async () => false,
  };
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'NO_REQUEST',
  });
  const calls: string[] = [];
  const adapter = {
    manifest: { name: 'github', version: '1', operations: {} },
    execute: async (request: { operation: string }) => {
      calls.push(request.operation);
      return { status: 'ok' as const, data: {}, attempts: 1 };
    },
  };
  const app = new Hono()
    .onError(onError)
    .route(
      '/',
      createGitHubReadRoutes({ db: db as never, workspaceId: 'ws-1', now: () => NOW, access }),
    )
    .route(
      '/',
      createGitHubActionRoutes({
        db: db as never,
        workspaceId: 'ws-1',
        now: () => NOW,
        access,
        adapter,
        tokenFor: async () => 'tok',
      }),
    );
  const get = (path: string, token = 'lup_viewer') =>
    app.request(path, { headers: { authorization: `Bearer ${token}` } });
  const post = (body: unknown, token = 'lup_operator') =>
    app.request('/api/v1/github/actions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { get, post, app, mine, theirs, calls };
}

describe('GET /api/v1/github/*', () => {
  it('refuses a caller with no credential, and one that is only an uploader', async () => {
    const { app, get } = await harness();
    for (const path of ['prs', 'issues', 'repos']) {
      expect((await app.request(`/api/v1/github/${path}`)).status).toBe(401);
      expect((await get(`/api/v1/github/${path}`, 'lup_uploader')).status).toBe(403);
    }
  });

  it('lists pull requests for the workspace, and only for it', async () => {
    const { get } = await harness();
    const response = await get('/api/v1/github/prs');
    expect(response.status).toBe(200);
    const page = GithubPullPageSchema.parse(await response.json());
    expect(page.items.map((item) => item.title)).toEqual(['Mine']);
    expect(page.items[0]).toMatchObject({ repository: 'octo/service', author: 'amy' });
  });

  it('applies filters from the query string and refuses a bad one', async () => {
    const { get } = await harness();
    const none = GithubPullPageSchema.parse(
      await (await get('/api/v1/github/prs?author=bob')).json(),
    );
    expect(none.items).toEqual([]);
    const bad = await get('/api/v1/github/prs?limit=500');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: expect.any(String) } });
    expect((await get('/api/v1/github/prs?state=nonsense')).status).toBe(400);
  });

  it('lists issues', async () => {
    const { get } = await harness();
    const page = GithubIssuePageSchema.parse(await (await get('/api/v1/github/issues')).json());
    expect(page.items.map((item) => item.title)).toEqual(['An issue']);
  });

  it('lists repositories and returns one, and a foreign project is not found', async () => {
    const { get, mine, theirs } = await harness();
    const list = GithubRepoListSchema.parse(await (await get('/api/v1/github/repos')).json());
    expect(list.items.map((item) => [item.name, item.openPullRequests, item.openIssues])).toEqual([
      ['Service', 1, 1],
    ]);
    const one = GithubRepoItemSchema.parse(
      await (await get(`/api/v1/github/repos/${mine}`)).json(),
    );
    expect(one.projectId).toBe(mine);
    expect((await get(`/api/v1/github/repos/${theirs}`)).status).toBe(404);
    expect((await get('/api/v1/github/repos/not-a-uuid')).status).toBe(404);
  });
});

describe('POST /api/v1/github/actions', () => {
  it('needs an operator: nobody, a viewer and an uploader are refused', async () => {
    const { app, post, mine } = await harness();
    const body = { actions: [{ action: 'close', projectId: mine, number: 1 }] };
    expect(
      (await app.request('/api/v1/github/actions', { method: 'POST', body: JSON.stringify(body) }))
        .status,
    ).toBe(401);
    expect((await post(body, 'lup_viewer')).status).toBe(403);
    expect((await post(body, 'lup_uploader')).status).toBe(403);
  });

  it('runs the actions and answers one result each', async () => {
    const { post, mine, calls } = await harness();
    const response = await post({
      actions: [
        { action: 'close', projectId: mine, number: 1 },
        { action: 'comment', projectId: mine, number: 1, body: 'Closing.' },
      ],
    });
    expect(response.status).toBe(200);
    const parsed = GithubActionsResponseSchema.parse(await response.json());
    expect(parsed.results.map((result) => [result.action, result.outcome])).toEqual([
      ['close', 'ok'],
      ['comment', 'ok'],
    ]);
    expect(calls).toEqual(['updateIssue', 'createIssueComment']);
  });

  it('plans without writing on a dry run', async () => {
    const { post, mine, calls } = await harness();
    const parsed = GithubActionsResponseSchema.parse(
      await (
        await post({ dryRun: true, actions: [{ action: 'close', projectId: mine, number: 1 }] })
      ).json(),
    );
    expect(parsed.dryRun).toBe(true);
    expect(parsed.results[0]?.outcome).toBe('planned');
    expect(calls).toEqual([]);
  });

  it('refuses a body that is not a known action, an empty list, and too many', async () => {
    const { post, mine } = await harness();
    expect(
      (await post({ actions: [{ action: 'delete-repo', projectId: mine, number: 1 }] })).status,
    ).toBe(400);
    expect((await post({ actions: [] })).status).toBe(400);
    const many = Array.from({ length: 51 }, () => ({
      action: 'close',
      projectId: mine,
      number: 1,
    }));
    expect((await post({ actions: many })).status).toBe(400);
    expect(
      (await post({ actions: [{ action: 'merge', projectId: mine, number: 1 }] })).status,
    ).toBe(400);
    expect((await post('nonsense')).status).toBe(400);
  });

  it('will not touch another workspace’s project', async () => {
    const { post, theirs, calls } = await harness();
    const parsed = GithubActionsResponseSchema.parse(
      await (await post({ actions: [{ action: 'close', projectId: theirs, number: 2 }] })).json(),
    );
    expect(parsed.results[0]?.outcome).toBe('refused');
    expect(calls).toEqual([]);
  });
});
