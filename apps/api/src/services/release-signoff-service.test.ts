import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { DomainError } from '../errors/domain-error.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { listSignoffs, recordSignoff } from './release-signoff-service.js';

/** Release sign-off (plan Wave 1 task 5), against the real migration graph. */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await project(db, 'ws-1');
  return { db, projectId, mine: { db: db as never, workspaceId: 'ws-1' } };
}

async function project(db: MigratedDb, workspaceId: string) {
  const [row] = await db
    .insert(schema.projects)
    .values({
      workspaceId,
      name: 'app',
      slug: `app-${String(Math.random()).slice(2, 10)}`,
      defaultBranch: 'main',
      repositoryUrl: 'https://github.com/acme/app',
      profile: {},
    })
    .returning({ id: schema.projects.id });
  return row?.id ?? '';
}

const body = (decision: 'ship' | 'hold') => ({
  commit: 'abc1234',
  decision,
  reason: 'QA signed off the smoke suite',
});

describe('a release sign-off', () => {
  it('records the decision against the verdict, newest first', async () => {
    const { projectId, mine } = await setup();
    const first = await recordSignoff(mine, {
      projectId,
      body: body('hold'),
      verdict: 'caution',
      actor: 'token:operator',
      isAdmin: false,
    });
    expect(first).toMatchObject({ decision: 'hold', verdict: 'caution', override: false });
    await recordSignoff(mine, {
      projectId,
      body: body('ship'),
      verdict: 'go',
      actor: 'token:operator',
      isAdmin: false,
    });
    expect((await listSignoffs(mine, projectId)).map((row) => row.decision)).toEqual([
      'ship',
      'hold',
    ]);
  });

  it('lets only an admin ship against no-go, and labels it an override', async () => {
    const { projectId, mine } = await setup();
    const refused = await recordSignoff(mine, {
      projectId,
      body: body('ship'),
      verdict: 'no-go',
      actor: 'token:operator',
      isAdmin: false,
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(DomainError);
    const overridden = await recordSignoff(mine, {
      projectId,
      body: body('ship'),
      verdict: 'no-go',
      actor: 'token:admin',
      isAdmin: true,
    });
    expect(overridden.override).toBe(true);
  });

  it("never shows one workspace another workspace's sign-offs", async () => {
    const { projectId, mine, db } = await setup();
    await recordSignoff(mine, {
      projectId,
      body: body('hold'),
      verdict: 'go',
      actor: 'token:operator',
      isAdmin: false,
    });
    const theirs = { db: db as never, workspaceId: 'ws-2' };
    expect(await listSignoffs(theirs, projectId)).toEqual([]);
  });
});
