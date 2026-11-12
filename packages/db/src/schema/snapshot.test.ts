import { readdirSync, readFileSync } from 'node:fs';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

/**
 * The newest snapshot is the schema as it stands (ledger MNT-193).
 *
 * The snapshots stopped at `0004` while the journal reached `0059`, so `pnpm db:generate` would
 * have rewritten every later migration. This holds the newest snapshot to the newest journal
 * entry and to the schema module's tables and columns. Read without `drizzle-kit/api`, which
 * resolves `drizzle-orm` through pnpm's hoisting and fails on a clean install.
 */
const META = new URL('../../drizzle/meta/', import.meta.url);
const journal = JSON.parse(readFileSync(new URL('_journal.json', META), 'utf8')) as {
  entries: Array<{ idx: number }>;
};
const latestName =
  readdirSync(META)
    .filter((name) => /^\d{4}_snapshot\.json$/u.test(name))
    .sort()
    .at(-1) ?? '';
const snapshot = JSON.parse(readFileSync(new URL(latestName, META), 'utf8')) as {
  tables: Record<string, { name: string; columns: Record<string, unknown> }>;
};

/** table name to its sorted column names */
function shape(entries: Array<[string, string[]]>): Record<string, string[]> {
  return Object.fromEntries(entries.map(([name, cols]) => [name, [...cols].sort()]).sort());
}

describe('the drizzle snapshot', () => {
  it('belongs to the newest migration in the journal', () => {
    const newest = journal.entries.at(-1)?.idx ?? -1;
    expect(latestName).toBe(`${String(newest).padStart(4, '0')}_snapshot.json`);
  });

  it('has exactly the tables and columns the schema module declares', () => {
    const declared = shape(
      (Object.values(schema) as unknown[])
        .filter((value): value is PgTable => is(value, PgTable))
        .map((table) => [
          getTableName(table),
          Object.values(getTableColumns(table)).map((column) => column.name),
        ]),
    );
    const recorded = shape(
      Object.values(snapshot.tables).map((table) => [table.name, Object.keys(table.columns)]),
    );
    expect(Object.keys(declared).length).toBeGreaterThan(40);
    expect(recorded).toEqual(declared);
  });
});
