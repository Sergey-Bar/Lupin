import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import * as schema from '@lupin/db';
import { CockpitSchema } from '@lupin/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import { weeklyShare } from '../services/ai-code-outcomes.js';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { createCockpitRoutes } from './cockpit.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-26T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const sha = (character: string) => character.repeat(40);

/** A person in the fixtures. Nothing the cockpit returns may carry it. */
const AUTHOR = 'alice-person';

async function harness(workspaceId = 'ws-1') {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const tokens: Record<string, Caller> = {
    lup_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
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
  const app = new Hono()
    .onError(onError)
    .route('/', createCockpitRoutes({ db: db as never, workspaceId, access, now: () => NOW }));
  return { app, db };
}

async function project(db: MigratedDb, workspaceId: string, slug: string) {
  const [row] = await db
    .insert(schema.projects)
    .values({
      workspaceId,
      name: `Project ${slug}`,
      slug,
      defaultBranch: 'main',
      repositoryUrl: 'https://github.com/octo/service',
    })
    .returning({ id: schema.projects.id });
  return (row as { id: string }).id;
}

async function snapshot(
  db: MigratedDb,
  workspaceId: string,
  projectId: string,
  days: number,
  score: number,
  extra: Partial<typeof schema.healthSnapshots.$inferInsert> = {},
) {
  await db.insert(schema.healthSnapshots).values({
    workspaceId,
    projectId,
    branch: 'main',
    takenAt: daysAgo(days),
    score,
    letter: 'B',
    grade: {},
    formulaVersion: 1,
    ...extra,
  });
}

/** A project with a score that fell from 80 to 74 on a merged pull request. */
async function seededProject(db: MigratedDb, workspaceId = 'ws-1', slug = 'service') {
  const projectId = await project(db, workspaceId, slug);
  await snapshot(db, workspaceId, projectId, 8, 80);
  await snapshot(db, workspaceId, projectId, 2, 74, { commitSha: sha('a') });
  await db.insert(schema.pullRequests).values({
    workspaceId,
    projectId,
    externalId: '42',
    number: 42,
    state: 'merged',
    authorLogin: AUTHOR,
    headBranch: 'feature/cache',
    baseBranch: 'main',
    title: 'Rewrite the cache',
    openedAt: daysAgo(4),
    mergedAt: daysAgo(2),
    mergeCommitSha: sha('a'),
    lastActivityAt: daysAgo(2),
  });
  await db.insert(schema.scanSnapshots).values([
    {
      workspaceId,
      projectId,
      hour: daysAgo(8),
      takenAt: daysAgo(8),
      coverage: 70,
      maturity: 50,
      flakyTests: 2,
    },
    {
      workspaceId,
      projectId,
      hour: daysAgo(1),
      takenAt: daysAgo(1),
      coverage: 60,
      maturity: 50,
      flakyTests: 5,
    },
  ]);
  return projectId;
}

const get = (app: Hono, url: string, token: string | null = 'lup_viewer') =>
  app.request(url, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });

describe('GET /api/v1/cockpit', () => {
  it('answers better-or-worse and why, by its contract, to a viewer', async () => {
    const { app, db } = await harness();
    const projectId = await seededProject(db);
    const response = await get(app, `/api/v1/cockpit?projectId=${projectId}`);
    expect(response.status).toBe(200);
    const cockpit = CockpitSchema.parse(await response.json());
    expect(cockpit.window).toBe('7d');
    expect(cockpit.overall).toMatchObject({ score: 74, baseline: 80, delta: -6, status: 'worse' });
    expect(cockpit.headline).toBe(
      'Down 6 points since last week, mostly lower coverage and more flaky tests.',
    );
    expect(cockpit.overall.drivers).toMatchObject([
      {
        kind: 'pull_request',
        ref: '42',
        label: 'PR #42: Rewrite the cache',
        url: 'https://github.com/octo/service/pull/42',
        candidate: false,
      },
    ]);
    expect(cockpit.repository).toEqual({ owner: 'octo', repo: 'service' });
  });

  it('shows the project with the most recent health reading when none is named', async () => {
    const { app, db } = await harness();
    await project(db, 'ws-1', 'quiet');
    const busy = await seededProject(db);
    const cockpit = CockpitSchema.parse(await (await get(app, '/api/v1/cockpit')).json());
    expect(cockpit.projectId).toBe(busy);
  });

  it('compares with the last successful production deployment for window=release', async () => {
    const { app, db } = await harness();
    const projectId = await seededProject(db);
    await db.insert(schema.deployments).values({
      workspaceId: 'ws-1',
      projectId,
      source: 'push',
      externalId: 'deploy-1',
      environment: 'production',
      status: 'success',
      createdAt: daysAgo(5),
    });
    const cockpit = CockpitSchema.parse(
      await (await get(app, `/api/v1/cockpit?projectId=${projectId}&window=release`)).json(),
    );
    expect(cockpit.since).toBe(daysAgo(5).toISOString());
    expect(cockpit.overall).toMatchObject({ baseline: 80, score: 74, status: 'worse' });
    expect(cockpit.headline).toMatch(/^Down 6 points since the last release/);
  });

  it('says a snapshot from before commits were recorded has an unknown cause', async () => {
    const { app, db } = await harness();
    const projectId = await project(db, 'ws-1', 'legacy');
    await snapshot(db, 'ws-1', projectId, 8, 80, { formulaVersion: 1 });
    await snapshot(db, 'ws-1', projectId, 2, 74, { formulaVersion: 1, commitSha: null });
    const cockpit = CockpitSchema.parse(
      await (await get(app, `/api/v1/cockpit?projectId=${projectId}`)).json(),
    );
    expect(cockpit.overall.drivers).toMatchObject([{ kind: 'unknown', ref: null }]);
  });

  it('refuses to compare readings from before formula versions existed', async () => {
    const { app, db } = await harness();
    const projectId = await project(db, 'ws-1', 'old');
    await snapshot(db, 'ws-1', projectId, 8, 80, { formulaVersion: 0 });
    await snapshot(db, 'ws-1', projectId, 2, 74, { formulaVersion: 1 });
    const cockpit = CockpitSchema.parse(
      await (await get(app, `/api/v1/cockpit?projectId=${projectId}`)).json(),
    );
    expect(cockpit.overall).toMatchObject({ delta: null, status: 'formula_changed' });
  });

  it('carries no person: not the pull request author, whatever the project holds', async () => {
    const { app, db } = await harness();
    const projectId = await seededProject(db);
    const body = await (await get(app, `/api/v1/cockpit?projectId=${projectId}`)).text();
    expect(body).not.toContain(AUTHOR);
  });

  it('refuses a caller with no credential', async () => {
    const { app } = await harness();
    expect((await get(app, '/api/v1/cockpit', null)).status).toBe(401);
    expect((await get(app, '/api/v1/cockpit', 'lup_unknown')).status).toBe(401);
  });

  it('rejects a window it does not know, and a blank project id', async () => {
    const { app } = await harness();
    expect((await get(app, '/api/v1/cockpit?window=year')).status).toBe(400);
    expect((await get(app, '/api/v1/cockpit?projectId=')).status).toBe(400);
  });

  it('says there is no project to show in an empty workspace', async () => {
    const { app } = await harness();
    expect((await get(app, '/api/v1/cockpit')).status).toBe(404);
  });
});

describe('GET /api/v1/cockpit across workspaces', () => {
  it("does not show another workspace's project, even by its id", async () => {
    const { app, db } = await harness('ws-1');
    const foreign = await seededProject(db, 'ws-2', 'foreign');
    const response = await get(app, `/api/v1/cockpit?projectId=${foreign}`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Down');
  });

  it("does not let another workspace's newer readings choose the default project", async () => {
    const { app, db } = await harness('ws-1');
    const own = await project(db, 'ws-1', 'own');
    await snapshot(db, 'ws-1', own, 6, 70);
    // ws-2's reading is newer. Were the default chosen across workspaces, it would win.
    const foreign = await project(db, 'ws-2', 'foreign');
    await snapshot(db, 'ws-2', foreign, 0.1, 99);
    const cockpit = CockpitSchema.parse(await (await get(app, '/api/v1/cockpit')).json());
    expect(cockpit.projectId).toBe(own);
  });

  it("does not mix another workspace's readings into a project's own", async () => {
    const { app, db } = await harness('ws-1');
    const own = await project(db, 'ws-1', 'own');
    await snapshot(db, 'ws-1', own, 8, 80);
    await snapshot(db, 'ws-1', own, 2, 78);
    const foreign = await project(db, 'ws-2', 'foreign');
    await snapshot(db, 'ws-2', foreign, 1, 10);
    const cockpit = CockpitSchema.parse(
      await (await get(app, `/api/v1/cockpit?projectId=${own}`)).json(),
    );
    expect(cockpit.overall).toMatchObject({ score: 78, baseline: 80, delta: -2 });
  });
});

describe('GET /api/v1/cockpit pace', () => {
  const merged = async (
    db: MigratedDb,
    workspaceId: string,
    projectId: string,
    number: number,
    at: string,
    extra: Partial<typeof schema.pullRequests.$inferInsert> = {},
  ) =>
    db.insert(schema.pullRequests).values({
      workspaceId,
      projectId,
      externalId: `${workspaceId}-${String(number)}`,
      number,
      state: 'merged',
      headBranch: `feature/${String(number)}`,
      baseBranch: 'main',
      title: `Change ${String(number)}`,
      openedAt: new Date(at),
      mergedAt: new Date(at),
      mergeCommitSha: number.toString(16).padEnd(40, '0'),
      lastActivityAt: new Date(at),
      additions: 10,
      deletions: 5,
      ...extra,
    });

  it('counts what merged into the shown branch each week, beside the score', async () => {
    const { app, db } = await harness();
    const projectId = await project(db, 'ws-1', 'paced');
    await snapshot(db, 'ws-1', projectId, 8, 80);
    await snapshot(db, 'ws-1', projectId, 1, 74);
    await merged(db, 'ws-1', projectId, 1, '2026-10-20T09:00:00Z', {
      additions: 100,
      deletions: 20,
    });
    await merged(db, 'ws-1', projectId, 2, '2026-10-21T09:00:00Z', {
      attribution: 'agent-authored',
    });
    // Merged into another branch: it did not land on the branch being shown.
    await merged(db, 'ws-1', projectId, 3, '2026-10-21T10:00:00Z', { baseBranch: 'release/1' });
    // Never merged.
    await db.insert(schema.pullRequests).values({
      workspaceId: 'ws-1',
      projectId,
      externalId: 'open-4',
      number: 4,
      state: 'open',
      baseBranch: 'main',
      title: 'Open',
      openedAt: daysAgo(1),
      lastActivityAt: daysAgo(1),
      additions: 999,
      deletions: 999,
    });
    const cockpit = CockpitSchema.parse(
      await (await get(app, `/api/v1/cockpit?projectId=${projectId}`)).json(),
    );
    expect(cockpit.pace).toHaveLength(12);
    const week = cockpit.pace.find((entry) => entry.weekStart === '2026-10-19');
    expect(week).toMatchObject({
      merged: 2,
      linesChanged: 135,
      aiAuthored: 1,
      aiShare: 50,
      score: 74,
      formulaVersion: 1,
    });
  });

  it("agrees with the AI-code share's own weekly counts, so there is one answer to how much merged", async () => {
    const { app, db } = await harness();
    const projectId = await project(db, 'ws-1', 'agreed');
    const dates: Array<[string, 'agent-authored' | 'ai-assisted' | 'human' | 'unknown']> = [
      ['2026-09-02T09:00:00Z', 'human'],
      ['2026-09-03T09:00:00Z', 'agent-authored'],
      ['2026-10-06T09:00:00Z', 'ai-assisted'],
      ['2026-10-07T09:00:00Z', 'unknown'],
      ['2026-10-22T09:00:00Z', 'human'],
    ];
    let number = 0;
    for (const [at, attribution] of dates) {
      number += 1;
      await merged(db, 'ws-1', projectId, number, at, { attribution });
    }
    const cockpit = CockpitSchema.parse(
      await (await get(app, `/api/v1/cockpit?projectId=${projectId}`)).json(),
    );
    const share = weeklyShare(
      dates.map(([at, attribution]) => ({ mergedAt: at, attribution })),
      NOW,
      77,
    );
    for (const week of share) {
      const pace = cockpit.pace.find((entry) => entry.weekStart === week.weekStart);
      expect(pace, `week ${week.weekStart}`).toMatchObject({
        merged: week.total,
        aiAuthored: week.agentAuthored + week.aiAssisted,
        unattributed: week.unknown,
      });
    }
  });

  it("does not count another workspace's merged pull requests", async () => {
    const { app, db } = await harness('ws-1');
    const own = await project(db, 'ws-1', 'own');
    const foreign = await project(db, 'ws-2', 'foreign');
    await merged(db, 'ws-1', own, 1, '2026-10-20T09:00:00Z');
    await merged(db, 'ws-2', foreign, 1, '2026-10-20T09:00:00Z');
    await merged(db, 'ws-2', foreign, 2, '2026-10-21T09:00:00Z');
    const cockpit = CockpitSchema.parse(
      await (await get(app, `/api/v1/cockpit?projectId=${own}`)).json(),
    );
    expect(cockpit.pace.reduce((sum, week) => sum + week.merged, 0)).toBe(1);
  });

  it('lists a recent merge without a human approval, and a large untested one, from the stored columns', async () => {
    const { app, db } = await harness();
    const projectId = await project(db, 'ws-1', 'risky');
    await snapshot(db, 'ws-1', projectId, 1, 74);
    await merged(db, 'ws-1', projectId, 1, '2026-10-24T09:00:00Z', { humanApprovalCount: 0 });
    await merged(db, 'ws-1', projectId, 2, '2026-10-24T10:00:00Z', {
      humanApprovalCount: 1,
      additions: 700,
      testsTouched: false,
    });
    await merged(db, 'ws-1', projectId, 3, '2026-10-24T11:00:00Z', { humanApprovalCount: 2 });
    const cockpit = CockpitSchema.parse(
      await (await get(app, `/api/v1/cockpit?projectId=${projectId}`)).json(),
    );
    expect(cockpit.risks.items.map((item) => [item.number, item.kind]).sort()).toEqual([
      [1, 'merged_without_human_approval'],
      [2, 'large_change_without_tests'],
    ]);
  });

  it("does not list another workspace's pull requests as risks", async () => {
    const { app, db } = await harness('ws-1');
    const own = await project(db, 'ws-1', 'own-risk');
    const foreign = await project(db, 'ws-2', 'foreign-risk');
    await merged(db, 'ws-2', foreign, 1, '2026-10-24T09:00:00Z', { humanApprovalCount: 0 });
    const cockpit = CockpitSchema.parse(
      await (await get(app, `/api/v1/cockpit?projectId=${own}`)).json(),
    );
    expect(cockpit.risks).toEqual({ total: 0, items: [] });
  });
});

describe('GET /api/v1/projects/:id/cockpit/report.html', () => {
  const url = (projectId: string, query = '') =>
    `/api/v1/projects/${projectId}/cockpit/report.html${query}`;

  it('serves the cockpit as one page that fetches nothing, to a viewer', async () => {
    const { app, db } = await harness();
    const projectId = await seededProject(db);
    const response = await get(app, url(projectId));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/u);
    const page = await response.text();
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('Down 6 points since last week');
    expect(page).toContain('Project service');
    expect(page).toContain('<a href="https://github.com/octo/service/pull/42"');
    expect(page).not.toContain('<script');
  });

  it('forbids the browser from loading anything into it, and from keeping or sniffing it', async () => {
    const { app, db } = await harness();
    const projectId = await seededProject(db);
    const { headers } = await get(app, url(projectId));
    expect(headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('is shown in the browser by default and offered as a download on request', async () => {
    const { app, db } = await harness();
    const projectId = await seededProject(db);
    expect((await get(app, url(projectId))).headers.get('content-disposition')).toBeNull();
    const download = await get(app, url(projectId, '?download=1'));
    expect(download.headers.get('content-disposition')).toBe(
      'attachment; filename="lupin-cockpit-project-service-2026-10-26.html"',
    );
  });

  it('compares with the window it is asked for', async () => {
    const { app, db } = await harness();
    const projectId = await seededProject(db);
    const page = await (await get(app, url(projectId, '?window=release'))).text();
    expect(page).toContain('Since the last release');
  });

  it('escapes a project name that tries to be markup, in the page and in the file name', async () => {
    const { app, db } = await harness();
    const [row] = await db
      .insert(schema.projects)
      .values({
        workspaceId: 'ws-1',
        name: '<script>alert(1)</script>',
        slug: '"; rm -rf /',
        defaultBranch: 'main',
      })
      .returning({ id: schema.projects.id });
    const projectId = (row as { id: string }).id;
    await snapshot(db, 'ws-1', projectId, 8, 80);
    await snapshot(db, 'ws-1', projectId, 2, 74);
    const response = await get(app, url(projectId, '?download=1'));
    expect(await response.text()).not.toContain('<script>alert(1)');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="lupin-cockpit-[a-z0-9-]+-2026-10-26\.html"$/u,
    );
  });

  it('carries no person', async () => {
    const { app, db } = await harness();
    const projectId = await seededProject(db);
    expect(await (await get(app, url(projectId))).text()).not.toContain(AUTHOR);
  });

  it('refuses a caller with no credential, and a window or a project it does not know', async () => {
    const { app, db } = await harness();
    const projectId = await seededProject(db);
    expect((await get(app, url(projectId), null)).status).toBe(401);
    expect((await get(app, url(projectId, '?window=year'))).status).toBe(400);
    expect((await get(app, url('not-a-project'))).status).toBe(404);
  });

  it("does not render another workspace's project, even by its id", async () => {
    const { app, db } = await harness('ws-1');
    const foreign = await seededProject(db, 'ws-2', 'foreign');
    const response = await get(app, url(foreign));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Down 6 points');
  });
});
