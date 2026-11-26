import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { migrationSql } from '../test-support/migrated-database.js';
import { DrizzleRunRepository } from './drizzle-run-repository.js';
import type { RunRecord } from './run-repository.js';

/**
 * Query budgets for the dashboard's reads (plan 1795712849115 task 6).
 *
 * The runs listing has its own budget (`execution/run-listing-queries.test.ts`). These are the
 * reads the dashboard and the run-detail page make through the run repository: each must
 * issue the same number of statements however much history the install has, because an
 * operator opens them first after an incident, and a query per run is a page that gets
 * slower the longer Lupin has been running.
 *
 * Counted on the PGlite client itself, against the real migration graph, so every statement
 * Drizzle issues is seen.
 */

const WORKSPACE = 'ws-1';
let client: PGlite;

function counting(): { repository: DrizzleRunRepository; statements: string[] } {
  const statements: string[] = [];
  const originalQuery = client.query.bind(client);
  const originalExec = client.exec.bind(client);
  const counted = Object.create(client) as PGlite;
  counted.query = ((...args: Parameters<typeof originalQuery>) => {
    statements.push(String(args[0]));
    return originalQuery(...args);
  }) as typeof originalQuery;
  counted.exec = ((sql: Parameters<typeof originalExec>[0]) => {
    statements.push(String(sql));
    return originalExec(sql);
  }) as typeof originalExec;
  const db = drizzle(counted, { schema });
  return { repository: new DrizzleRunRepository(db, WORKSPACE), statements };
}

async function statementsFor(
  operation: (repository: DrizzleRunRepository) => Promise<unknown>,
): Promise<number> {
  const { repository, statements } = counting();
  await operation(repository);
  return statements.length;
}

const runIds: string[] = [];

async function seed(count: number): Promise<void> {
  const repository = new DrizzleRunRepository(drizzle(client, { schema }), WORKSPACE);
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    runIds.push(id);
    await repository.upsertRun({
      id,
      workspaceId: WORKSPACE,
      startedAt: new Date(Date.UTC(2026, 10, 1, 0, runIds.length)).toISOString(),
      finishedAt: null,
      status: index % 3 === 0 ? 'failed' : 'passed',
      total: 2,
      passed: 1,
      failed: 1,
      flaky: 0,
      skipped: 0,
      durationMs: 1000,
      branch: 'main',
    } as RunRecord);
    for (const name of ['a', 'b']) {
      await repository.upsertTest({
        id: `${id}-${name}`,
        runId: id,
        title: `test ${name}`,
        file: 'spec.ts',
        stableId: `spec.ts::test ${name}`,
        status: name === 'a' ? 'passed' : 'failed',
        durationMs: 10,
        errorCode: null,
        errorMessage: name === 'a' ? null : 'expected 1 to be 2',
      });
    }
  }
}

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql());
  await drizzle(client, { schema })
    .insert(schema.workspaces)
    .values({ id: WORKSPACE, name: WORKSPACE, configPath: '.', createdAt: new Date() });
});

afterAll(async () => {
  await client.close();
});

describe('dashboard reads issue a fixed number of statements', () => {
  it('reads the three dashboard numbers in one statement, at 3 runs and at 40', async () => {
    await seed(3);
    const small = await statementsFor((r) => r.getAnalyticsSummary());
    await seed(37);
    const large = await statementsFor((r) => r.getAnalyticsSummary());

    expect(large).toBe(small);
    expect(large).toBe(1);
  });

  it('loads the tests of a page of runs in a bounded batch, not one read per run', async () => {
    const few = await statementsFor((r) => r.listTestsForRuns(runIds.slice(0, 2)));
    const many = await statementsFor((r) => r.listTestsForRuns(runIds.slice(0, 40)));

    expect(many).toBe(few);
  });

  it('reads one run and its tests in the same count whatever the history holds', async () => {
    const target = runIds[0] ?? '';
    const run = await statementsFor((r) => r.getRun(target));
    const tests = await statementsFor((r) => r.listTests(target));

    expect(run).toBe(1);
    expect(tests).toBe(1);
  });

  it('the harness can fail: a read per run is counted as one statement per run', async () => {
    const perRun = await statementsFor(async (r) => {
      for (const id of runIds.slice(0, 5)) await r.getRun(id);
    });
    expect(perRun).toBe(5);
  });
});
