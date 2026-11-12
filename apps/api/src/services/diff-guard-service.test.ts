import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { DiffGuardStatusSchema, type DiffGuardUpload } from '@lupin/shared-contracts';
import { migratedDatabase } from '../test-support/migrated-database.js';
import {
  diffGuardStatus,
  recordDiffGuard,
  tamperForRisk,
  type DiffGuardOptions,
} from './diff-guard-service.js';

/**
 * `lupin diff-guard`'s reports against the real migration graph: one row per commit, the read
 * that says "not checked" apart from "checked and clean", retention, and the workspace wall.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-11-11T09:00:00.000Z');

async function setup(extra: Partial<DiffGuardOptions> = {}) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const [project] = await db
    .insert(schema.projects)
    .values({ workspaceId: 'ws-1', name: 'Service', slug: 'service' })
    .returning({ id: schema.projects.id });
  const options: DiffGuardOptions = {
    db: db as never,
    workspaceId: 'ws-1',
    now: () => NOW,
    ...extra,
  };
  return { db, options, projectId: (project as { id: string }).id };
}

function upload(overrides: Partial<DiffGuardUpload> = {}): DiffGuardUpload {
  return {
    commit: 'ABC1234',
    base: 'origin/main',
    pullRequest: 12,
    branch: 'feature/cart',
    report: {
      version: 'diff-guard/1',
      findings: [
        { kind: 'skip-added', path: 'src/cart.test.ts', line: 11, side: 'head' },
        { kind: 'assertion-removed', path: 'src/cart.test.ts', line: 5, side: 'base' },
      ],
      counts: { 'skip-added': 1, 'assertion-removed': 1 },
      filesChecked: 4,
      truncated: false,
    },
    ...overrides,
  };
}

describe('recordDiffGuard and diffGuardStatus', () => {
  it('says a commit nobody checked was not checked, not that it was clean', async () => {
    const { options, projectId } = await setup();
    const status = await diffGuardStatus(options, projectId, 'abc1234');
    expect(status).toEqual({ state: 'none', commit: 'abc1234' });
    expect(await tamperForRisk(options, projectId, 'abc1234')).toBeNull();
  });

  it('stores one report per commit, the later one winning, and reads it back', async () => {
    const { db, options, projectId } = await setup();
    await recordDiffGuard(options, projectId, upload());
    await recordDiffGuard(
      options,
      projectId,
      upload({
        report: {
          version: 'diff-guard/1',
          findings: [],
          counts: {},
          filesChecked: 4,
          truncated: false,
        },
      }),
    );
    expect(await db.select().from(schema.testTamperReports)).toHaveLength(1);
    const status = await diffGuardStatus(options, projectId, 'abc1234');
    expect(DiffGuardStatusSchema.parse(status)).toMatchObject({
      state: 'reported',
      commit: 'abc1234',
      base: 'origin/main',
      pullRequest: 12,
      branch: 'feature/cart',
      report: { findings: [], counts: {} },
      reportedAt: NOW.toISOString(),
    });
    expect(await tamperForRisk(options, projectId, 'ABC1234')).toEqual({ findings: 0, kinds: [] });
  });

  it('gives the risk model the total and the kinds, counting past the kept findings', async () => {
    const { options, projectId } = await setup();
    await recordDiffGuard(
      options,
      projectId,
      upload({
        report: {
          version: 'diff-guard/1',
          findings: [{ kind: 'skip-added', path: 'a.test.ts', line: 1, side: 'head' }],
          counts: { 'skip-added': 250, 'threshold-lowered': 1 },
          filesChecked: 9,
          truncated: true,
        },
      }),
    );
    expect(await tamperForRisk(options, projectId, 'abc1234')).toEqual({
      findings: 251,
      kinds: ['skip-added', 'threshold-lowered'],
    });
  });

  it('keeps only the most recent reports of a project', async () => {
    let clock = NOW.getTime();
    const { db, options, projectId } = await setup({
      retention: 1,
      now: () => new Date((clock += 1000)),
    });
    await recordDiffGuard(options, projectId, upload({ commit: 'aaa1111' }));
    await recordDiffGuard(options, projectId, upload({ commit: 'bbb2222' }));
    const rows = await db.select().from(schema.testTamperReports);
    expect(rows.map((row) => row.commitSha)).toEqual(['bbb2222']);
  });

  it('stores no text of a line: the row is kinds, paths and numbers', async () => {
    const { db, options, projectId } = await setup();
    await recordDiffGuard(options, projectId, upload());
    const [row] = await db.select().from(schema.testTamperReports);
    expect(Object.keys(row?.findings[0] ?? {}).sort()).toEqual(['kind', 'line', 'path', 'side']);
  });
});

describe('workspace isolation', () => {
  it('is another workspace’s project, as far as another workspace can tell, not found', async () => {
    const { db, options, projectId } = await setup();
    const other = { ...options, workspaceId: 'ws-2' };
    await expect(recordDiffGuard(other, projectId, upload())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await db.select().from(schema.testTamperReports)).toEqual([]);
    await recordDiffGuard(options, projectId, upload());
    await expect(diffGuardStatus(other, projectId, 'abc1234')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(tamperForRisk(other, projectId, 'abc1234')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reads only its own workspace’s report for a commit both workspaces have', async () => {
    const { db, options, projectId } = await setup();
    const [foreign] = await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-2', name: 'Foreign', slug: 'foreign' })
      .returning({ id: schema.projects.id });
    const foreignId = (foreign as { id: string }).id;
    await recordDiffGuard({ ...options, workspaceId: 'ws-2' }, foreignId, upload());
    expect(await diffGuardStatus(options, projectId, 'abc1234')).toEqual({
      state: 'none',
      commit: 'abc1234',
    });
  });
});
