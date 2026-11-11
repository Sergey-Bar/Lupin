import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from './migrations.js';

/**
 * The worker's hand-written SQL names columns that exist (ledger MNT-194).
 *
 * `apps/worker/src/postgres-store.ts` talks to PostgreSQL through `pg` with hand-typed rows,
 * so a column renamed in a migration still typechecks there and fails only when the worker
 * runs the query. Every statement it sends is read from its source and `PREPARE`d against the
 * real migration graph: preparing resolves every table, column, function and parameter type,
 * and executes nothing.
 */
const SOURCE = new URL('../../../apps/worker/src/postgres-store.ts', import.meta.url);
const TRANSACTION = new Set(['BEGIN', 'COMMIT', 'ROLLBACK']);

/** The string literal starting at `at`, escapes undone, or `null` when there is none. */
function literalAt(source: string, at: number): string | null {
  const quote = source[at];
  if (quote !== '`' && quote !== "'") return null;
  let text = '';
  for (let index = at + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      text += source[index + 1] ?? '';
      index += 1;
    } else if (char === quote) {
      return text;
    } else {
      text += char;
    }
  }
  return null;
}

/** Every SQL literal passed as the first argument of a `.query(` call. */
function statements(source: string): { calls: number; sql: string[] } {
  let calls = 0;
  const sql: string[] = [];
  for (let at = source.indexOf('.query'); at !== -1; at = source.indexOf('.query', at + 1)) {
    let open = at + '.query'.length;
    if (source[open] === '<') open = source.indexOf('>', open) + 1;
    if (source[open] !== '(') continue;
    calls += 1;
    let start = open + 1;
    while (/\s/u.test(source[start] ?? '')) start += 1;
    const text = literalAt(source, start);
    if (text !== null) sql.push(text);
  }
  return { calls, sql };
}

let client: PGlite;
const { calls, sql } = statements(readFileSync(SOURCE, 'utf8'));
const queries = sql.filter((text) => !TRANSACTION.has(text.trim()));

beforeAll(async () => {
  client = await createMigratedDatabase();
}, 120_000);

afterAll(async () => {
  await client.close();
});

async function prepare(text: string, name: string): Promise<void> {
  await client.exec(`PREPARE ${name} AS ${text}`);
  await client.exec(`DEALLOCATE ${name}`);
}

describe('the worker store against the migrated schema', () => {
  it('reads every query the store sends, as a literal it can check', () => {
    // A query built at run time could not be checked here, so there must be none.
    expect(sql).toHaveLength(calls);
    expect(sql.filter((text) => text.includes('${'))).toEqual([]);
    expect(queries.length).toBeGreaterThan(20);
  });

  it('prepares every statement: each table, column and parameter resolves', async () => {
    const refused: string[] = [];
    for (const [index, text] of queries.entries()) {
      try {
        await prepare(text, `worker_q${String(index)}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        refused.push(`${reason}\n  ${text.replace(/\s+/gu, ' ').slice(0, 160)}`);
      }
    }
    expect(refused).toEqual([]);
  });

  it('refuses a statement naming a column that does not exist, so the check can fail', async () => {
    const claim = queries.find((text) => text.includes('lease_owner'));
    expect(claim).toBeDefined();
    await expect(
      prepare((claim ?? '').replaceAll('lease_owner', 'lease_holder'), 'worker_renamed'),
    ).rejects.toThrow(/lease_holder/u);
  });
});
