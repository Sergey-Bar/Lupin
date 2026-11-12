import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import {
  FINDING_SEVERITIES,
  HEALTH_DIMENSIONS,
  HEALTH_GATES,
  PortfolioShapeSchema,
  ScopedShapeSchema,
  type HealthGrade,
} from '@lupin/shared-contracts';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  portfolioShape,
  pullRequestShape,
  repositoryShape,
  type ShapeOptions,
} from './shape-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-11-11T12:00:00.000Z');
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const sha = (seed: string) => seed.repeat(40).slice(0, 40);

function grade(letter: 'A' | 'B' | 'C' | 'D' | 'F'): HealthGrade {
  return {
    score: 80,
    letter,
    incomplete: false,
    incompleteReason: null,
    cappedBy: 'tests',
    cappingValue: 80,
    limiter: 'Tests',
    dimensions: HEALTH_DIMENSIONS.map((dimension) => ({
      dimension,
      measured: true,
      score: 80,
      letter,
      weight: 1,
      tools: [],
      openFindings: Object.fromEntries(FINDING_SEVERITIES.map((severity) => [severity, 0])),
      summary: [],
    })) as unknown as HealthGrade['dimensions'],
    gates: HEALTH_GATES.map((id) => ({ id, tripped: false, enabled: true, statement: id })),
    fixNext: [],
  } as HealthGrade;
}

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const project = async (workspaceId: string, name: string) => {
    const [row] = await db
      .insert(schema.projects)
      .values({ workspaceId, name, slug: name.toLowerCase(), defaultBranch: 'main' })
      .returning({ id: schema.projects.id });
    return (row as { id: string }).id;
  };
  const projectId = await project('ws-1', 'Shop');
  const quietId = await project('ws-1', 'Quiet');
  const foreignId = await project('ws-2', 'Foreign');
  const options: ShapeOptions = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  return { db, options, projectId, quietId, foreignId };
}

async function snapshot(
  db: MigratedDb,
  projectId: string,
  letter: 'A' | 'B' | 'C' | 'D' | 'F',
  takenAt: Date,
  workspaceId = 'ws-1',
) {
  await db.insert(schema.healthSnapshots).values({
    workspaceId,
    projectId,
    branch: 'main',
    takenAt,
    score: 80,
    letter,
    grade: grade(letter),
    formulaVersion: 1,
  });
}

async function run(
  db: MigratedDb,
  projectId: string,
  status: 'passed' | 'failed' | 'interrupted' | 'running',
  startedAt: Date,
  workspaceId = 'ws-1',
) {
  await db.insert(schema.runs).values({
    workspaceId,
    projectId,
    startedAt,
    status,
    total: 10,
    failed: status === 'failed' ? 3 : 0,
    commitSha: sha('c'),
  });
}

async function pull(
  db: MigratedDb,
  projectId: string,
  number: number,
  values: Partial<typeof schema.pullRequests.$inferInsert> = {},
) {
  await db.insert(schema.pullRequests).values({
    workspaceId: 'ws-1',
    projectId,
    externalId: `${projectId}-${String(number)}`,
    number,
    state: 'merged',
    title: `Change ${String(number)}`,
    body: 'Fixes #1',
    openedAt: hoursAgo(30),
    mergedAt: hoursAgo(5),
    lastActivityAt: hoursAgo(5),
    humanApprovalCount: 1,
    approvedAt: hoursAgo(10),
    headSha: sha(String(number % 10)),
    syncedAt: hoursAgo(1),
    ...values,
  });
}

describe('repositoryShape', () => {
  it('is good when the grade, the last run, the phases and the open risk are all fine and recent', async () => {
    const { db, options, projectId } = await setup();
    await snapshot(db, projectId, 'B', hoursAgo(5));
    await run(db, projectId, 'passed', hoursAgo(3));
    await pull(db, projectId, 1);
    await db.insert(schema.runs).values({
      workspaceId: 'ws-1',
      projectId,
      startedAt: hoursAgo(6),
      status: 'passed',
      total: 4,
      commitSha: sha('1'),
    });
    const shape = ScopedShapeSchema.parse(await repositoryShape(options, projectId));
    expect(shape.signals.map((entry) => `${entry.id}:${entry.shape}`)).toEqual([
      'grade:good',
      'tests:good',
      'phases:good',
      'risk:good',
    ]);
    expect(shape).toMatchObject({ shape: 'good', freshness: 'fresh', name: 'Shop' });
  });

  it('is bad on a failed last run, and says so', async () => {
    const { db, options, projectId } = await setup();
    await snapshot(db, projectId, 'B', hoursAgo(5));
    await run(db, projectId, 'passed', hoursAgo(9));
    await run(db, projectId, 'failed', hoursAgo(2));
    // A run still going is not the last finished one.
    await run(db, projectId, 'running', hoursAgo(1));
    const shape = await repositoryShape(options, projectId);
    expect(shape.shape).toBe('bad');
    expect(shape.reason).toBe('The last run failed: 3 of 10 tests.');
  });

  it('is never good with delivery unsynced, and is stale on an old grade', async () => {
    const { db, options, quietId } = await setup();
    await snapshot(db, quietId, 'A', hoursAgo(24 * 20));
    await run(db, quietId, 'passed', hoursAgo(24 * 20));
    const shape = await repositoryShape(options, quietId);
    expect(shape).toMatchObject({ shape: 'caution', freshness: 'stale' });
    expect(shape.signals.find((entry) => entry.id === 'phases')).toMatchObject({
      shape: 'unknown',
      reason: 'No pull request has been read: turn on delivery sync.',
    });
  });

  it('is unknown with nothing measured at all', async () => {
    const { options, quietId } = await setup();
    expect(await repositoryShape(options, quietId)).toMatchObject({
      shape: 'unknown',
      freshness: 'never',
      measuredAt: null,
    });
  });
});

describe('pullRequestShape', () => {
  it('reads the change risk at its latest head and the phases', async () => {
    const { db, options, projectId } = await setup();
    await pull(db, projectId, 2, { state: 'open', mergedAt: null, humanApprovalCount: 0 });
    await db.insert(schema.pullRequestRiskAssessments).values({
      workspaceId: 'ws-1',
      projectId,
      prNumber: 2,
      headSha: sha('2'),
      level: 'critical',
      score: 90,
      version: 'change-risk/1',
      factors: [
        { id: 'test-tampering', kind: 'risk', points: 40, detail: 'Skip added.', evidence: null },
        {
          id: 'ai-authorship',
          kind: 'risk',
          points: 50,
          detail: 'Agent-authored.',
          evidence: null,
        },
      ],
      assessedAt: hoursAgo(2),
    });
    const shape = ScopedShapeSchema.parse(await pullRequestShape(options, projectId, 2));
    expect(shape).toMatchObject({ pullRequest: 2, shape: 'bad', freshness: 'fresh' });
    expect(shape.signals[0]).toMatchObject({
      id: 'risk',
      shape: 'bad',
      reason: 'Change risk critical, 90 points.',
    });
  });

  it('is not measured until the gate assesses it, and null when nobody synced it', async () => {
    const { db, options, projectId } = await setup();
    await pull(db, projectId, 3, { state: 'open', mergedAt: null });
    const shape = await pullRequestShape(options, projectId, 3);
    expect(shape?.shape).not.toBe('good');
    expect(shape?.signals[0]?.reason).toBe('The gate has not assessed it yet.');
    expect(await pullRequestShape(options, projectId, 99)).toBeNull();
  });
});

describe('portfolioShape', () => {
  it('lists this workspace’s repositories worst first, under the worst of their signals', async () => {
    const { db, options, projectId, quietId, foreignId } = await setup();
    await snapshot(db, projectId, 'B', hoursAgo(5));
    await snapshot(db, quietId, 'F', hoursAgo(5));
    await snapshot(db, foreignId, 'A', hoursAgo(5), 'ws-2');
    const read = PortfolioShapeSchema.parse(await portfolioShape(options));
    expect(read.projects.map((entry) => `${entry.name}:${entry.shape}`)).toEqual([
      'Quiet:bad',
      'Shop:caution',
    ]);
    expect(read.overall.shape).toBe('bad');
    expect(read).toMatchObject({ total: 2, truncated: false });
  });
});

describe('workspace isolation', () => {
  it('is another workspace’s project, as far as another workspace can tell, not found', async () => {
    const { options, projectId } = await setup();
    const other = { ...options, workspaceId: 'ws-2' };
    await expect(repositoryShape(other, projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(pullRequestShape(other, projectId, 1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never reads a grade or a run stamped with another workspace that names this project', async () => {
    const { db, options, projectId } = await setup();
    await snapshot(db, projectId, 'A', hoursAgo(1), 'ws-2');
    await run(db, projectId, 'failed', hoursAgo(1), 'ws-2');
    const shape = await repositoryShape(options, projectId);
    expect(shape.signals.find((entry) => entry.id === 'grade')?.shape).toBe('unknown');
    expect(shape.signals.find((entry) => entry.id === 'tests')?.shape).toBe('unknown');
  });
});
