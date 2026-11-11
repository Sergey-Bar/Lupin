import { afterEach, describe, expect, it, vi } from 'vitest';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { audit, recordAudit } from './access-service.js';

/**
 * The two ways a decision is audited (ledger MNT-173). `recordAudit` is for a decision that
 * must not stand without its row (a break-glass sign-in): it throws. `audit` is for one that
 * has already been made: it never throws, and it says so when the row was lost instead of
 * dropping it without a word.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(closers.splice(0).map((close) => close()));
});

const ENTRY = {
  actor: 'session',
  action: 'auth.break-glass',
  resourceType: 'installation',
  resourceId: 'install-1',
};

async function database() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  return db;
}

describe('recordAudit', () => {
  it('writes the row, and throws when the row cannot be written', async () => {
    const db = await database();
    await recordAudit({ db: db as never, workspaceId: 'ws-1' }, ENTRY);
    // No such workspace: `audit_events.workspace_id` has a `restrict` key onto `workspaces`.
    await expect(
      recordAudit({ db: db as never, workspaceId: 'no-such-workspace' }, ENTRY),
    ).rejects.toThrow();
  });
});

describe('audit', () => {
  it('never throws, and reports the row it lost with the action that lost it', async () => {
    const db = await database();
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      audit({ db: db as never, workspaceId: 'no-such-workspace' }, ENTRY),
    ).resolves.toBeUndefined();
    expect(reported).toHaveBeenCalledTimes(1);
    expect(String(reported.mock.calls[0]?.[0])).toContain('audit row lost: auth.break-glass');
  });
});
