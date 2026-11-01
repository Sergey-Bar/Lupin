import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigrations, type Migration } from './migrations.js';

/**
 * `0053_health_snapshot_commit`: a health snapshot names the commit of the report that caused
 * it and the version of the formula that graded it (cockpit, Task 1).
 *
 * The migration is read on top of the graph as an installation has it, with a snapshot row
 * written before the migration, because that row is the case that matters: it must read as
 * "no commit, unversioned" and never as version 1, or a trend would compare a score from an
 * unknown formula with one from the current formula.
 */
const TAG = '0053_health_snapshot_commit';
const opened: PGlite[] = [];
afterEach(async () => {
  for (const client of opened.splice(0)) await client.close();
});

function statements(migration: Migration): string[] {
  return migration.sql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function applyThrough(client: PGlite, last: string | null, first: string | null) {
  let started = first === null;
  for (const migration of readMigrations()) {
    if (!started && migration.tag === first) started = true;
    if (!started) continue;
    for (const statement of statements(migration)) await client.exec(statement);
    if (migration.tag === last) return;
  }
}

async function beforeTheMigration(): Promise<PGlite> {
  const client = new PGlite();
  opened.push(client);
  const migrations = readMigrations();
  const position = migrations.findIndex((migration) => migration.tag === TAG);
  if (position === -1) throw new Error(`${TAG} is missing from the journal`);
  await applyThrough(client, migrations[position - 1]?.tag ?? null, null);
  return client;
}

async function seedProject(client: PGlite): Promise<string> {
  await client.exec(
    `insert into workspaces (id, name, config_path, created_at) values ('ws-1', 'ws-1', '.', now()) on conflict do nothing`,
  );
  const inserted = await client.query<{ id: string }>(
    `insert into projects (workspace_id, name, slug, default_branch)
     values ('ws-1', 'Service', 'service', 'main') returning id`,
  );
  return (inserted.rows[0] as { id: string }).id;
}

describe('0053_health_snapshot_commit', () => {
  it('leaves a snapshot written before it with no commit and formula version 0', async () => {
    const client = await beforeTheMigration();
    const projectId = await seedProject(client);
    await client.query(
      `insert into health_snapshots (workspace_id, project_id, branch, grade)
       values ('ws-1', $1, 'main', '{}'::jsonb)`,
      [projectId],
    );
    await applyThrough(client, TAG, TAG);
    const rows = await client.query<{ commit_sha: string | null; formula_version: number }>(
      `select commit_sha, formula_version from health_snapshots`,
    );
    expect(rows.rows).toEqual([{ commit_sha: null, formula_version: 0 }]);
  });

  it('accepts a commit and a positive version on a new row', async () => {
    const client = await beforeTheMigration();
    const projectId = await seedProject(client);
    await applyThrough(client, TAG, TAG);
    await client.query(
      `insert into health_snapshots (workspace_id, project_id, branch, grade, commit_sha, formula_version)
       values ('ws-1', $1, 'main', '{}'::jsonb, 'abc1234', 1)`,
      [projectId],
    );
    const rows = await client.query<{ commit_sha: string; formula_version: number }>(
      `select commit_sha, formula_version from health_snapshots`,
    );
    expect(rows.rows).toEqual([{ commit_sha: 'abc1234', formula_version: 1 }]);
  });

  it('refuses a negative formula version, so 0 stays the only name for "unversioned"', async () => {
    const client = await beforeTheMigration();
    const projectId = await seedProject(client);
    await applyThrough(client, TAG, TAG);
    await expect(
      client.query(
        `insert into health_snapshots (workspace_id, project_id, branch, grade, formula_version)
         values ('ws-1', $1, 'main', '{}'::jsonb, -1)`,
        [projectId],
      ),
    ).rejects.toThrow(/health_snapshots_formula_version_check/);
  });
});
