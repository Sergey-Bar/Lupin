import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import * as schema from './index.js';

/**
 * The newest snapshot is the schema as it stands (ledger MNT-193).
 *
 * The snapshots stopped at `0004` while the journal reached `0059`: every later migration was
 * written by hand, so `pnpm db:generate` would have diffed the schema against one 55 migrations
 * old and written all of them again, and `pnpm db:check`, which reads only the snapshots, was
 * checking a schema from September. These two assertions are what keep the two in step.
 */
const META = new URL('../../drizzle/meta/', import.meta.url);

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const journal = JSON.parse(readFileSync(new URL('_journal.json', META), 'utf8')) as Journal;
const snapshots = readdirSync(META)
  .filter((name) => /^\d{4}_snapshot\.json$/u.test(name))
  .sort();
const latestName = snapshots.at(-1) ?? '';
const latest = JSON.parse(readFileSync(new URL(latestName, META), 'utf8')) as {
  id: string;
} & Parameters<typeof generateMigration>[0];

describe('the drizzle snapshot', () => {
  it('belongs to the newest migration in the journal', () => {
    const newest = journal.entries.at(-1);
    expect(newest).toBeDefined();
    expect(latestName).toBe(`${String(newest?.idx).padStart(4, '0')}_snapshot.json`);
  });

  it('describes the schema module exactly, so generate would write nothing', async () => {
    const current = generateDrizzleJson(schema, latest.id);
    const statements = await generateMigration(latest, current);
    expect(statements).toEqual([]);
  });

  it('can see a difference, or the comparison above proves nothing', async () => {
    const current = generateDrizzleJson(schema, latest.id);
    const tables = { ...(current as unknown as { tables: Record<string, unknown> }).tables };
    const [first] = Object.keys(tables);
    if (first !== undefined) delete tables[first];
    const missing = { ...current, tables } as typeof current;
    expect(await generateMigration(latest, missing)).not.toEqual([]);
  });
});
