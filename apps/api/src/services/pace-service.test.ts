import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { PaceReportSchema } from '@lupin/shared-contracts';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { projectPace, type PaceOptions } from './pace-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const project = async (workspaceId: string, slug: string) => {
    const [row] = await db
      .insert(schema.projects)
      .values({ workspaceId, name: slug, slug })
      .returning({ id: schema.projects.id });
    return (row as { id: string }).id;
  };
  const projectId = await project('ws-1', 'service');
  const foreignId = await project('ws-2', 'foreign');
  const options: PaceOptions = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  return { db, options, projectId, foreignId };
}

let counter = 0;
async function merged(
  db: MigratedDb,
  projectId: string,
  values: Partial<typeof schema.pullRequests.$inferInsert> = {},
) {
  counter += 1;
  await db.insert(schema.pullRequests).values({
    workspaceId: 'ws-1',
    projectId,
    externalId: `pr-${String(counter)}`,
    number: counter,
    state: 'merged',
    title: 'x',
    openedAt: daysAgo(10),
    mergedAt: daysAgo(1),
    lastActivityAt: daysAgo(1),
    additions: 100,
    headSha: `${String(counter).padStart(4, '0')}${'a'.repeat(36)}`,
    ...values,
  });
}

async function runWith(
  db: MigratedDb,
  workspaceId: string,
  projectId: string,
  at: Date,
  stableIds: string[],
) {
  const [run] = await db
    .insert(schema.runs)
    .values({ workspaceId, projectId, startedAt: at, status: 'passed' })
    .returning({ id: schema.runs.id });
  const runId = (run as { id: string }).id;
  for (const stableId of stableIds) {
    await db.insert(schema.tests).values({
      id: `${runId}:${stableId}`,
      runId,
      workspaceId,
      title: stableId,
      file: 'a.test.ts',
      stableId,
      status: 'passed',
    });
  }
}

describe('projectPace', () => {
  it('is not configured for a project the sync never read', async () => {
    const { options, projectId } = await setup();
    const report = PaceReportSchema.parse(await projectPace(options, projectId, 2));
    expect(report).toMatchObject({ status: 'not_configured' });
    expect(report.weeks.at(-1)?.testsAdded).toBeNull();
  });

  it('reads merges, their head’s diff coverage and the tests first seen in the window', async () => {
    const { db, options, projectId } = await setup();
    await merged(db, projectId, {
      attribution: 'agent-authored',
      additions: 300,
      headSha: 'C'.repeat(40),
    });
    await merged(db, projectId, { mergedAt: daysAgo(8), additions: 50 });
    await merged(db, projectId, { mergedAt: daysAgo(400) });
    await merged(db, projectId, { state: 'open', mergedAt: null });
    await db.insert(schema.diffCoverageResults).values({
      workspaceId: 'ws-1',
      projectId,
      branch: 'feature',
      commitSha: 'c'.repeat(40),
      executable: 200,
      covered: 150,
      ratio: 0.75,
      computedAt: daysAgo(1),
    });
    // `old` was first seen before the window; `new-a` and `new-b` this week.
    await runWith(db, 'ws-1', projectId, daysAgo(60), ['old']);
    await runWith(db, 'ws-1', projectId, daysAgo(1), ['old', 'new-a', 'new-b']);

    const report = await projectPace(options, projectId, 2);
    expect(report.status).toBe('measured');
    expect(report.weeks.at(-1)).toMatchObject({
      mergedPullRequests: 1,
      changedLines: 300,
      aiShare: 1,
      testsAdded: 2,
      uncoveredLines: 50,
      unmeasuredLines: 0,
      debt: 50,
    });
    expect(report.weeks[0]).toMatchObject({ mergedPullRequests: 1, unmeasuredLines: 50 });
  });

  it('never reads another workspace’s project, pull requests or tests', async () => {
    const { db, options, projectId, foreignId } = await setup();
    await expect(projectPace({ ...options, workspaceId: 'ws-2' }, projectId)).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
    await db.insert(schema.pullRequests).values({
      workspaceId: 'ws-2',
      projectId: foreignId,
      externalId: 'f',
      number: 1,
      state: 'merged',
      title: 'theirs',
      openedAt: daysAgo(3),
      mergedAt: daysAgo(1),
      lastActivityAt: daysAgo(1),
      additions: 999,
    });
    await runWith(db, 'ws-2', foreignId, daysAgo(1), ['theirs']);
    const report = await projectPace(options, projectId, 2);
    expect(report.status).toBe('not_configured');
    expect(report.weeks.every((week) => week.changedLines === 0)).toBe(true);
  });
});
