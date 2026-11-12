import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigrations, type Migration } from './migrations.js';

/**
 * `0066_drop_dormant_tables` (ledger C-6, plan task 15).
 *
 * Fourteen tables were recorded in `docs/quality/capability-justification.md` as dormant:
 * nothing in `apps/`, `packages/`, `tools/` or `tests/` read or wrote them. One kept table,
 * `tests`, still carried a key onto `suites`; every other key onto a dropped table is held
 * by another dropped table.
 *
 * The migration follows 0030: it refuses to drop a table that holds rows, naming the table
 * and the count, unless `lupin.allow_drop_nonempty` is `on`, and it never uses `CASCADE`.
 */

const TAG = '0066_drop_dormant_tables';
const RUN = '00000000-0000-4000-8000-0000000000c1';
const DORMANT = [
  'suites',
  'attachments',
  'known_failures',
  'nl_query_history',
  'failure_taxonomy_rules',
  'failure_classifications',
  'locator_suggestions',
  'roles',
  'agent_sessions',
  'agent_session_runs',
  'agent_session_files',
  'generated_test_suggestions',
  'repair_attempts',
  'agent_conflicts',
] as const;

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

function target(): Migration {
  const found = readMigrations().find((migration) => migration.tag === TAG);
  if (found === undefined) throw new Error(`${TAG} is missing from the journal`);
  return found;
}

/** The graph up to, but not including, the migration under test. */
async function applyBefore(): Promise<PGlite> {
  const client = new PGlite();
  opened.push(client);
  for (const migration of readMigrations()) {
    if (migration.tag === TAG) break;
    for (const statement of statements(migration)) await client.exec(statement);
  }
  return client;
}

async function applyTarget(client: PGlite): Promise<void> {
  // One transaction, as the migrator runs it, so a raise leaves nothing half-applied.
  try {
    await client.exec(`BEGIN;\n${statements(target()).join(';\n')};\nCOMMIT;`);
  } catch (failure) {
    await client.exec('ROLLBACK');
    throw failure;
  }
}

async function tablesPresent(client: PGlite): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`,
    [[...DORMANT]],
  );
  return result.rows.map((row) => row.table_name);
}

/** Foreign keys held by a kept table that name one of the dormant tables. */
async function keptKeysOntoDormant(client: PGlite): Promise<string[]> {
  const result = await client.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND confrelid::regclass::text = ANY($1)
        AND NOT (conrelid::regclass::text = ANY($1))
      ORDER BY conname`,
    [[...DORMANT]],
  );
  return result.rows.map((row) => row.conname);
}

const SEED_KNOWN_FAILURE = `INSERT INTO known_failures (id, workspace_id, test_title, test_file, created_at)
  VALUES ('kf-1', 'default-workspace', 't', 'f', now())`;
const SEED_AGENT_SESSION = `INSERT INTO agent_sessions
    (id, workspace_id, provider, repository, pr_number, pr_branch, agent_name, created_at, updated_at)
  VALUES ('as-1', 'default-workspace', 'github', 'o/r', 1, 'b', 'agent', now(), now())`;

async function seedRun(client: PGlite): Promise<void> {
  await client.exec(
    `INSERT INTO runs (id, started_at, workspace_id) VALUES ('${RUN}', now(), 'default-workspace')`,
  );
}

describe(TAG, () => {
  it('drops all fourteen tables from an empty database, and the key tests held onto suites', async () => {
    const client = await applyBefore();
    expect(await tablesPresent(client)).toEqual([...DORMANT].sort());
    expect(await keptKeysOntoDormant(client)).toEqual(['tests_suite_id_suites_id_fk']);

    await applyTarget(client);

    expect(await tablesPresent(client)).toEqual([]);
    expect(await keptKeysOntoDormant(client)).toEqual([]);
  });

  for (const [table, seed] of [
    ['known_failures', SEED_KNOWN_FAILURE],
    ['agent_sessions', SEED_AGENT_SESSION],
  ] as const) {
    it(`refuses to drop ${table} while it holds rows, naming the table and the count`, async () => {
      const client = await applyBefore();
      await client.exec(seed);

      await expect(applyTarget(client)).rejects.toThrow(
        new RegExp(`${table}: 1 row\\(s\\).*lupin\\.allow_drop_nonempty`, 's'),
      );

      // Nothing was applied: every table and the key are still there.
      expect(await tablesPresent(client)).toEqual([...DORMANT].sort());
      expect(await keptKeysOntoDormant(client)).toHaveLength(1);
      const kept = await client.query(`SELECT 1 FROM ${table}`);
      expect(kept.rows).toHaveLength(1);
    });
  }

  it('refuses when the setting is present but not on', async () => {
    const client = await applyBefore();
    await client.exec(SEED_KNOWN_FAILURE);
    await client.exec(`SET lupin.allow_drop_nonempty = 'off'`);

    await expect(applyTarget(client)).rejects.toThrow(/known_failures: 1 row/);
    expect(await tablesPresent(client)).toEqual([...DORMANT].sort());
  });

  it('drops populated tables when the operator opts in, and keeps tests.suite_id', async () => {
    const client = await applyBefore();
    await seedRun(client);
    await client.exec(SEED_KNOWN_FAILURE);
    await client.exec(SEED_AGENT_SESSION);
    await client.exec(`
      INSERT INTO agent_session_runs (session_id, run_id, workspace_id, linked_at)
        VALUES ('as-1', '${RUN}', 'default-workspace', now());
      INSERT INTO suites (id, run_id, workspace_id, title)
        VALUES ('suite-1', '${RUN}', 'default-workspace', 'checkout');
      INSERT INTO tests (id, run_id, workspace_id, suite_id, title, file)
        VALUES ('t-1', '${RUN}', 'default-workspace', 'suite-1', 't', 'f');
    `);
    await client.exec(`SET lupin.allow_drop_nonempty = 'on'`);

    await applyTarget(client);

    expect(await tablesPresent(client)).toEqual([]);
    const runs = await client.query(`SELECT 1 FROM runs WHERE id = '${RUN}'`);
    expect(runs.rows).toHaveLength(1);
    // The pointer column stays, with its value, so the provenance is not erased.
    const test = await client.query<{ suite_id: string }>(
      `SELECT suite_id FROM tests WHERE id = 't-1'`,
    );
    expect(test.rows).toEqual([{ suite_id: 'suite-1' }]);
  });
});
