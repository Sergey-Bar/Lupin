import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  decodeCursor,
  encodeCursor,
  getRepoOverview,
  listIssues,
  listPullRequests,
  listRepos,
} from './github-inbox-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-23T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

async function seed() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const project = async (workspaceId: string, name: string, repositoryUrl: string | null) => {
    const [row] = await db
      .insert(schema.projects)
      .values({ workspaceId, name, slug: name.toLowerCase(), defaultBranch: 'main', repositoryUrl })
      .returning({ id: schema.projects.id });
    return (row as { id: string }).id;
  };
  const alpha = await project('ws-1', 'Alpha', 'https://github.com/octo/alpha.git');
  const beta = await project('ws-1', 'Beta', 'https://github.com/octo/beta.git');
  const foreign = await project('ws-2', 'Foreign', 'https://github.com/other/foreign.git');
  return { db, alpha, beta, foreign };
}

let counter = 0;
async function pull(
  db: MigratedDb,
  workspaceId: string,
  projectId: string,
  values: Partial<typeof schema.pullRequests.$inferInsert> = {},
) {
  counter += 1;
  await db.insert(schema.pullRequests).values({
    workspaceId,
    projectId,
    externalId: `pr-${String(counter)}`,
    number: counter,
    state: 'open',
    title: `PR ${String(counter)}`,
    openedAt: ago(5),
    lastActivityAt: ago(1),
    ...values,
  });
}

async function issue(
  db: MigratedDb,
  workspaceId: string,
  projectId: string,
  values: Partial<typeof schema.githubIssues.$inferInsert> = {},
) {
  counter += 1;
  await db.insert(schema.githubIssues).values({
    workspaceId,
    projectId,
    externalId: `is-${String(counter)}`,
    number: counter,
    state: 'open',
    title: `Issue ${String(counter)}`,
    openedAt: ago(5),
    lastActivityAt: ago(1),
    ...values,
  });
}

const query = (overrides: Record<string, unknown> = {}) => ({
  state: 'open' as const,
  limit: 50,
  ...overrides,
});

describe('listPullRequests', () => {
  it('lists open pull requests across projects, most recently active first, with repository names', async () => {
    const { db, alpha, beta } = await seed();
    await pull(db, 'ws-1', alpha, { title: 'older', lastActivityAt: ago(3) });
    await pull(db, 'ws-1', beta, { title: 'newer', lastActivityAt: ago(1), headSha: 'abc1234' });
    await pull(db, 'ws-1', alpha, { title: 'merged', state: 'merged', mergedAt: ago(1) });

    const page = await listPullRequests({ db, workspaceId: 'ws-1' }, query());
    expect(page.items.map((item) => item.title)).toEqual(['newer', 'older']);
    expect(page.items[0]).toMatchObject({
      projectName: 'Beta',
      repository: 'octo/beta',
      headSha: 'abc1234',
      state: 'open',
    });
    expect(page.nextCursor).toBeNull();
  });

  it('filters by state, author, label, review, checks, draft, project and staleness', async () => {
    const { db, alpha, beta } = await seed();
    await pull(db, 'ws-1', alpha, {
      title: 'a',
      authorLogin: 'amy',
      labels: ['bug'],
      reviewDecision: 'approved',
      checksState: 'success',
    });
    await pull(db, 'ws-1', alpha, {
      title: 'b',
      authorLogin: 'bob',
      labels: ['feature'],
      reviewDecision: 'changes_requested',
      checksState: 'failure',
      draft: true,
      lastActivityAt: ago(30),
    });
    await pull(db, 'ws-1', beta, { title: 'c', state: 'closed', closedAt: ago(2) });
    const ws = { db, workspaceId: 'ws-1' };
    const titles = async (q: Record<string, unknown>) =>
      (await listPullRequests(ws, query(q))).items.map((item) => item.title).sort();

    expect(await titles({})).toEqual(['a', 'b']);
    expect(await titles({ state: 'closed' })).toEqual(['c']);
    expect(await titles({ state: 'all' })).toEqual(['a', 'b', 'c']);
    expect(await titles({ author: 'amy' })).toEqual(['a']);
    expect(await titles({ label: 'feature' })).toEqual(['b']);
    expect(await titles({ review: 'changes_requested' })).toEqual(['b']);
    expect(await titles({ checks: 'success' })).toEqual(['a']);
    expect(await titles({ draft: true })).toEqual(['b']);
    expect(await titles({ projectId: beta, state: 'all' })).toEqual(['c']);
    expect(await titles({ staleDays: 14 })).toEqual(['b']);
  });

  it('pages by keyset without skipping or repeating an item that shares a timestamp', async () => {
    const { db, alpha } = await seed();
    const tie = ago(2);
    for (let index = 0; index < 5; index += 1) {
      await pull(db, 'ws-1', alpha, { title: `p${String(index)}`, lastActivityAt: tie });
    }
    const ws = { db, workspaceId: 'ws-1' };
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listPullRequests(ws, query({ limit: 2, cursor }));
      seen.push(...page.items.map((item) => item.title));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen.sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('never returns another workspace’s pull requests, even by project id', async () => {
    const { db, alpha, foreign } = await seed();
    await pull(db, 'ws-1', alpha, { title: 'mine' });
    await pull(db, 'ws-2', foreign, { title: 'theirs' });

    const mine = await listPullRequests({ db, workspaceId: 'ws-1' }, query());
    expect(mine.items.map((item) => item.title)).toEqual(['mine']);
    const probe = await listPullRequests(
      { db, workspaceId: 'ws-1' },
      query({ projectId: foreign }),
    );
    expect(probe.items).toEqual([]);
  });

  it('treats a cursor it cannot read as the first page, not as an error that leaks internals', async () => {
    const { db, alpha } = await seed();
    await pull(db, 'ws-1', alpha, { title: 'x' });
    const page = await listPullRequests({ db, workspaceId: 'ws-1' }, query({ cursor: '%%%' }));
    expect(page.items).toHaveLength(1);
  });
});

describe('cursors', () => {
  it('round-trip, and refuse a malformed value', () => {
    const cursor = encodeCursor(NOW, '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11');
    expect(decodeCursor(cursor)).toEqual({
      at: NOW,
      id: '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11',
    });
    expect(decodeCursor('nope')).toBeNull();
    expect(decodeCursor(Buffer.from('2026-13-45|x').toString('base64url'))).toBeNull();
    expect(
      decodeCursor(Buffer.from('2026-10-23T12:00:00.000Z|not-a-uuid').toString('base64url')),
    ).toBeNull();
  });
});

describe('listIssues', () => {
  it('lists, filters and isolates issues the same way', async () => {
    const { db, alpha, foreign } = await seed();
    await issue(db, 'ws-1', alpha, { title: 'bug one', labels: ['bug'], assignees: ['amy'] });
    await issue(db, 'ws-1', alpha, { title: 'done', state: 'closed', closedAt: ago(1) });
    await issue(db, 'ws-2', foreign, { title: 'theirs' });
    const ws = { db, workspaceId: 'ws-1' };

    expect((await listIssues(ws, query())).items.map((item) => item.title)).toEqual(['bug one']);
    expect(
      (await listIssues(ws, query({ state: 'all' }))).items.map((item) => item.title).sort(),
    ).toEqual(['bug one', 'done']);
    expect((await listIssues(ws, query({ label: 'bug' }))).items).toHaveLength(1);
    expect((await listIssues(ws, query({ label: 'nope' }))).items).toHaveLength(0);
    expect((await listIssues(ws, query({ projectId: foreign }))).items).toEqual([]);
    expect((await listIssues(ws, query())).items[0]).toMatchObject({
      repository: 'octo/alpha',
      assignees: ['amy'],
    });
  });
});

describe('listRepos', () => {
  it('counts open work per repository, and says which repositories are not being read', async () => {
    const { db, alpha, beta } = await seed();
    await db.insert(schema.deliverySources).values({
      workspaceId: 'ws-1',
      projectId: alpha,
      enabled: true,
      lastStatus: 'ok',
      lastSyncedAt: ago(0),
    });
    await pull(db, 'ws-1', alpha, {});
    await pull(db, 'ws-1', alpha, { lastActivityAt: ago(30) });
    await pull(db, 'ws-1', alpha, { state: 'merged', mergedAt: ago(1) });
    await issue(db, 'ws-1', alpha, {});
    await issue(db, 'ws-1', alpha, { state: 'closed', closedAt: ago(1) });

    const { items } = await listRepos({ db, workspaceId: 'ws-1', now: () => NOW });
    expect(items.map((item) => item.name)).toEqual(['Alpha', 'Beta']);
    expect(items[0]).toMatchObject({
      projectId: alpha,
      repository: 'octo/alpha',
      syncEnabled: true,
      lastStatus: 'ok',
      openPullRequests: 2,
      stalePullRequests: 1,
      openIssues: 1,
    });
    expect(items[1]).toMatchObject({
      projectId: beta,
      syncEnabled: false,
      openPullRequests: 0,
      state: null,
    });
  });

  it('leaves out a project that is not a repository on the configured host', async () => {
    const { db } = await seed();
    await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-1', name: 'Local', slug: 'local', repositoryUrl: null });
    const { items } = await listRepos({ db, workspaceId: 'ws-1', now: () => NOW });
    expect(items.map((item) => item.name)).toEqual(['Alpha', 'Beta']);
  });

  it('reads the stored repository state, and never another workspace’s', async () => {
    const { db, alpha, foreign } = await seed();
    const state = {
      community: null,
      protection: { state: 'unprotected' },
      alerts: {
        dependabot: { critical: 1, high: 0, medium: 0, low: 0, truncated: false },
        codeScanning: { unavailable: 'forbidden' },
        secretScanning: { critical: 0, high: 0, medium: 0, low: 0, truncated: false },
      },
      rateLimit: null,
    };
    await db
      .insert(schema.repoGithubState)
      .values({ workspaceId: 'ws-1', projectId: alpha, ...state });
    await db
      .insert(schema.repoGithubState)
      .values({ workspaceId: 'ws-2', projectId: foreign, ...state });

    const { items } = await listRepos({ db, workspaceId: 'ws-1', now: () => NOW });
    expect(items.map((item) => item.name)).toEqual(['Alpha', 'Beta']);
    expect(items[0]?.state?.protection).toEqual({ state: 'unprotected' });
    expect(items[0]?.state?.alerts.codeScanning).toEqual({ unavailable: 'forbidden' });
  });
});

describe('getRepoOverview', () => {
  it('grades a synced repository from its stored state and counts, and does not grade an unsynced one', async () => {
    const { db, alpha, beta } = await seed();
    await db.insert(schema.deliverySources).values({
      workspaceId: 'ws-1',
      projectId: alpha,
      enabled: true,
      lastStatus: 'ok',
      lastSyncedAt: ago(0),
    });
    await db.insert(schema.repoGithubState).values({
      workspaceId: 'ws-1',
      projectId: alpha,
      community: null,
      protection: { state: 'unprotected' },
      alerts: {
        dependabot: { critical: 0, high: 0, medium: 0, low: 0, truncated: false },
        codeScanning: { critical: 0, high: 0, medium: 0, low: 0, truncated: false },
        secretScanning: { critical: 0, high: 0, medium: 0, low: 0, truncated: false },
      },
      rateLimit: null,
    });
    await pull(db, 'ws-1', alpha, { checksState: 'failure' });
    await pull(db, 'ws-1', alpha, { mergeableState: 'dirty' });
    await pull(db, 'ws-1', alpha, { openedAt: ago(10), reviewCount: 0 });
    await pull(db, 'ws-1', alpha, { openedAt: ago(10), reviewCount: 2 });
    for (let index = 0; index < 5; index += 1) await issue(db, 'ws-1', alpha, {});
    await issue(db, 'ws-1', alpha, { labels: ['bug'] });

    const ws = { db, workspaceId: 'ws-1', now: () => NOW };
    const graded = await getRepoOverview(ws, alpha);
    expect(graded.health.findings.map((finding) => finding.id).sort()).toEqual([
      'conflicted-pull-requests',
      'failing-pull-requests',
      'no-branch-protection',
      'unreviewed-pull-requests',
      'untriaged-issues',
    ]);
    // A pull request the sync saw only 5 days ago is "unreviewed" only if it is over 3 days old
    // and has no review: three of the four qualify by age, one has reviews.
    expect(
      graded.health.findings.find((f) => f.id === 'unreviewed-pull-requests')?.evidence,
    ).toContain('3 pull requests');
    expect(graded.health.score).toBe(100 - 12 - 5 - 5 - 5 - 2);

    const ungraded = await getRepoOverview(ws, beta);
    expect(ungraded.health).toMatchObject({ score: null, grade: null });
  });

  it('returns one repository, or a not-found for another workspace’s', async () => {
    const { db, alpha, foreign } = await seed();
    const ws = { db, workspaceId: 'ws-1', now: () => NOW };
    expect((await getRepoOverview(ws, alpha)).name).toBe('Alpha');
    await expect(getRepoOverview(ws, foreign)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
