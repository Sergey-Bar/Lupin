import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { BriefingSchema } from '@lupin/shared-contracts';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { portfolioBriefing, repositoryBriefing, type BriefingOptions } from './briefing-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-11-11T12:00:00.000Z');
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const sha = (seed: string) => seed.repeat(40).slice(0, 40);

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const project = async (workspaceId: string, name: string) => {
    const [row] = await db
      .insert(schema.projects)
      .values({ workspaceId, name, slug: name.toLowerCase() })
      .returning({ id: schema.projects.id });
    return (row as { id: string }).id;
  };
  const projectId = await project('ws-1', 'Shop');
  const quietId = await project('ws-1', 'Quiet');
  const foreignId = await project('ws-2', 'Foreign');
  const options: BriefingOptions = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  return { db, options, projectId, quietId, foreignId };
}

async function pull(
  db: MigratedDb,
  projectId: string,
  number: number,
  values: Partial<typeof schema.pullRequests.$inferInsert> = {},
  workspaceId = 'ws-1',
) {
  await db.insert(schema.pullRequests).values({
    workspaceId,
    projectId,
    externalId: `${projectId}-${String(number)}`,
    number,
    state: 'merged',
    title: `Change ${String(number)}`,
    body: 'Fixes #1',
    openedAt: hoursAgo(30),
    mergedAt: hoursAgo(5),
    lastActivityAt: hoursAgo(5),
    headSha: sha(String(number % 10)),
    ...values,
  });
}

async function assess(
  db: MigratedDb,
  projectId: string,
  number: number,
  level: string,
  score: number,
  options: { tampered?: boolean; headSha?: string; workspaceId?: string } = {},
) {
  await db.insert(schema.pullRequestRiskAssessments).values({
    workspaceId: options.workspaceId ?? 'ws-1',
    projectId,
    prNumber: number,
    headSha: options.headSha ?? sha(String(number % 10)),
    level,
    score,
    version: 'change-risk/1',
    factors:
      options.tampered === true
        ? [{ id: 'test-tampering', kind: 'risk', points: 40, detail: 'skip added', evidence: null }]
        : [],
    assessedAt: hoursAgo(6),
  });
}

describe('repositoryBriefing', () => {
  it('reads what merged, what got riskier and what is open at high risk, each cited', async () => {
    const { db, options, projectId } = await setup();
    await pull(db, projectId, 1, { attribution: 'agent-authored' });
    await pull(db, projectId, 2, { attribution: 'ai-assisted', humanApprovalCount: 1 });
    await pull(db, projectId, 3);
    // Merged before the window: not read.
    await pull(db, projectId, 4, { mergedAt: hoursAgo(24 * 30) });
    await assess(db, projectId, 1, 'critical', 90, { tampered: true });
    await pull(db, projectId, 5, { state: 'open', mergedAt: null, title: 'Rewrite checkout' });
    await assess(db, projectId, 5, 'high', 55);
    // Assessed high, but at an older head: not a current decision.
    await pull(db, projectId, 6, { state: 'open', mergedAt: null });
    await assess(db, projectId, 6, 'high', 70, { headSha: sha('f') });
    await db.insert(schema.deployments).values({
      workspaceId: 'ws-1',
      projectId,
      source: 'push',
      externalId: 'd-1',
      environment: 'production',
      status: 'success',
      createdAt: hoursAgo(3),
    });

    const briefing = BriefingSchema.parse(await repositoryBriefing(options, projectId));
    const text = Object.fromEntries(briefing.items.map((entry) => [entry.id, entry.text]));
    expect(text['shipped.merged']).toBe('3 pull requests merged, 2 AI-written.');
    expect(text['shipped.deployments']).toBe('1 deployment to production.');
    expect(text['riskier.high-risk']).toBe('1 merged at high risk or above.');
    expect(text['riskier.unreviewed-ai']).toBe('1 AI-written merged with no person approving.');
    expect(text['riskier.tampered']).toBe('1 merged with changes that weakened its tests.');
    const decisions = briefing.items.filter((entry) => entry.section === 'decide');
    expect(decisions.map((entry) => entry.text)).toEqual([
      '#5 Rewrite checkout: high risk, 55 points, still open.',
    ]);
    expect(decisions[0]?.link).toBe(`/dashboard/prs/${projectId}/5`);
    expect(briefing.shape).toBe('bad');
    expect(briefing.scope).toEqual({ kind: 'repository', projectId, name: 'Shop' });
  });

  it('says delivery sync is off rather than reporting zero merged', async () => {
    const { options, quietId } = await setup();
    const briefing = await repositoryBriefing(options, quietId);
    expect(briefing.items.map((entry) => entry.id)).toContain('shipped.not-synced');
    expect(briefing.items.some((entry) => entry.id === 'shipped.merged')).toBe(false);
  });
});

describe('portfolioBriefing', () => {
  it('sums every repository in this workspace and names each decision’s repository', async () => {
    const { db, options, projectId, quietId, foreignId } = await setup();
    await pull(db, projectId, 1);
    await pull(db, quietId, 1, { attribution: 'agent-authored' });
    await pull(db, quietId, 2, { state: 'open', mergedAt: null, title: 'Drop the cache' });
    await assess(db, quietId, 2, 'critical', 80);
    await pull(db, foreignId, 1, {}, 'ws-2');
    await pull(db, foreignId, 2, {}, 'ws-2');

    const briefing = BriefingSchema.parse(await portfolioBriefing(options));
    expect(briefing.scope).toEqual({ kind: 'portfolio', projects: 2 });
    const text = Object.fromEntries(briefing.items.map((entry) => [entry.id, entry.text]));
    expect(text['shipped.merged']).toBe('2 pull requests merged, 1 AI-written.');
    expect(
      briefing.items.filter((entry) => entry.section === 'decide').map((entry) => entry.text),
    ).toEqual(['Quiet #2 Drop the cache: critical risk, 80 points, still open.']);
  });
});

describe('workspace isolation', () => {
  it('is another workspace’s project, as far as another workspace can tell, not found', async () => {
    const { options, projectId } = await setup();
    await expect(
      repositoryBriefing({ ...options, workspaceId: 'ws-2' }, projectId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never counts a row stamped with another workspace that names this project', async () => {
    const { db, options, projectId } = await setup();
    await pull(db, projectId, 1);
    await pull(db, projectId, 2, { externalId: 'stray' }, 'ws-2');
    await pull(db, projectId, 3, { state: 'open', mergedAt: null, externalId: 'stray-3' }, 'ws-2');
    await assess(db, projectId, 3, 'critical', 99, { workspaceId: 'ws-2' });
    const briefing = await repositoryBriefing(options, projectId);
    const text = Object.fromEntries(briefing.items.map((entry) => [entry.id, entry.text]));
    expect(text['shipped.merged']).toBe('1 pull request merged, 0 AI-written.');
    expect(briefing.items.some((entry) => entry.section === 'decide')).toBe(false);
  });
});
