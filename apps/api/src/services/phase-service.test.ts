import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import {
  PhaseStripSchema,
  PortfolioPhasesSchema,
  RepositoryPhasesSchema,
} from '@lupin/shared-contracts';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { recordDiffGuard } from './diff-guard-service.js';
import {
  portfolioPhases,
  pullRequestPhases,
  repositoryPhases,
  type PhaseOptions,
} from './phase-service.js';

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
  const options: PhaseOptions = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
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
    state: 'open',
    title: `Change ${String(number)}`,
    body: 'Fixes #1',
    openedAt: hoursAgo(10),
    lastActivityAt: hoursAgo(1),
    headSha: sha(String(number % 10)),
    ...values,
  });
}

async function runOn(db: MigratedDb, projectId: string, commitSha: string, total: number) {
  await db.insert(schema.runs).values({
    workspaceId: 'ws-1',
    projectId,
    startedAt: hoursAgo(2),
    status: 'passed',
    commitSha,
    total,
  });
}

describe('pullRequestPhases', () => {
  it('reads an AI change merged unreviewed, with tests on its head that diff-guard flagged', async () => {
    const { db, options, projectId } = await setup();
    await pull(db, projectId, 1, {
      state: 'merged',
      attribution: 'agent-authored',
      mergedAt: hoursAgo(1),
      headSha: sha('a'),
    });
    await runOn(db, projectId, sha('a'), 12);
    await recordDiffGuard(options, projectId, {
      commit: sha('a'),
      base: 'origin/main',
      report: {
        version: 'diff-guard/1',
        findings: [],
        counts: { 'skip-added': 1 },
        filesChecked: 1,
        truncated: false,
      },
    });
    const strip = PhaseStripSchema.parse(await pullRequestPhases(options, projectId, 1));
    expect(strip.phases.map((step) => `${step.phase}:${step.state}:${step.shape}`)).toEqual([
      'plan:done:good',
      'code:done:good',
      'test:done:bad',
      'review:skipped:bad',
      'release:done:good',
    ]);
    expect(strip.skipped).toEqual(['review']);
  });

  it('answers nothing for a pull request the sync has not read', async () => {
    const { options, projectId } = await setup();
    expect(await pullRequestPhases(options, projectId, 99)).toBeNull();
  });
});

describe('repositoryPhases', () => {
  it('rolls up the window, names the bottleneck and lists what is stuck, longest first', async () => {
    const { db, options, projectId } = await setup();
    await pull(db, projectId, 1, { openedAt: hoursAgo(100) });
    await pull(db, projectId, 2, { openedAt: hoursAgo(60) });
    await pull(db, projectId, 3, {
      state: 'merged',
      mergedAt: hoursAgo(2),
      humanApprovalCount: 1,
      approvedAt: hoursAgo(5),
    });
    // Out of the window, merged long ago: not read.
    await pull(db, projectId, 4, {
      state: 'merged',
      mergedAt: hoursAgo(2000),
      lastActivityAt: hoursAgo(2000),
    });
    const read = RepositoryPhasesSchema.parse(await repositoryPhases(options, projectId, 30));
    expect(read.changes).toBe(3);
    expect(read.configured).toBe(true);
    expect(read.bottleneck).toEqual({
      phase: 'review',
      sentence: 'Review is the bottleneck: 2 changes waiting over 48 hours.',
    });
    expect(read.stuck.map((entry) => [entry.pullRequest, entry.phase, entry.hours])).toEqual([
      [1, 'review', 100],
      [2, 'review', 60],
    ]);
    expect(read.phases.find((entry) => entry.phase === 'review')).toMatchObject({
      stuck: 2,
      shape: 'caution',
    });
  });

  it('is not configured with no sync and no pull request, and every phase unknown', async () => {
    const { options, quietId } = await setup();
    const read = await repositoryPhases(options, quietId);
    expect(read).toMatchObject({ configured: false, changes: 0, bottleneck: null });
    expect(read.phases.every((entry) => entry.shape === 'unknown')).toBe(true);
  });
});

describe('portfolioPhases', () => {
  it('lists every repository worst first, with one shape per phase, and only this workspace’s', async () => {
    const { db, options, projectId, foreignId } = await setup();
    await pull(db, projectId, 1, {
      state: 'merged',
      mergedAt: hoursAgo(1),
      attribution: 'agent-authored',
    });
    await pull(db, foreignId, 1, {}, 'ws-2');
    const read = PortfolioPhasesSchema.parse(await portfolioPhases(options));
    expect(read.projects.map((row) => row.name)).toEqual(['Shop', 'Quiet']);
    expect(read.projects[0]?.phases.find((entry) => entry.phase === 'review')?.shape).toBe('bad');
    expect(read).toMatchObject({ total: 2, truncated: false });
  });
});

describe('workspace isolation', () => {
  it('is another workspace’s project, as far as another workspace can tell, not found', async () => {
    const { db, options, projectId } = await setup();
    await pull(db, projectId, 1);
    const other = { ...options, workspaceId: 'ws-2' };
    await expect(pullRequestPhases(other, projectId, 1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(repositoryPhases(other, projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never reads another workspace’s pull request with the same number', async () => {
    const { db, options, projectId, foreignId } = await setup();
    await pull(db, foreignId, 1, {}, 'ws-2');
    expect(await pullRequestPhases(options, projectId, 1)).toBeNull();
    // A row stamped with another workspace that names this project is still not this
    // workspace's: the workspace filter is the wall, not the project id alone.
    await pull(db, projectId, 2, { externalId: 'stray' }, 'ws-2');
    expect(await pullRequestPhases(options, projectId, 2)).toBeNull();
    expect((await repositoryPhases(options, projectId)).changes).toBe(0);
  });
});
