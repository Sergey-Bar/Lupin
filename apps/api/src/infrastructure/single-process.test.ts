import { describe, expect, it, vi } from 'vitest';
import { claimSingleProcess, SINGLE_PROCESS_LOCK_KEY } from './single-process.js';

/**
 * ADR-006 is one API process per database, and several things rely on it (the rate limiters,
 * the admin-change lock in `routes/members.ts`, the GitHub App token cache, the OIDC cache).
 * Nothing checked it (ledger MNT-175). The claim is a session advisory lock held for the life
 * of the process: a second API against the same database is refused in production and warned
 * about elsewhere.
 */
function fakeDatabase() {
  let holder: object | null = null;
  const released: string[] = [];
  const connect = vi.fn(async () => {
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        expect(params).toEqual([SINGLE_PROCESS_LOCK_KEY]);
        if (sql.includes('pg_try_advisory_lock')) {
          const granted = holder === null;
          if (granted) holder = client;
          return { rows: [{ granted }] };
        }
        if (holder === client) holder = null;
        return { rows: [] };
      }),
      release: vi.fn(() => released.push('client')),
    };
    return client;
  });
  return { pool: { connect } as never, released };
}

describe('claimSingleProcess', () => {
  it('lets the first process start and keeps its connection until shutdown', async () => {
    const { pool, released } = fakeDatabase();
    const first = await claimSingleProcess(pool, { production: true, warn: vi.fn() });
    expect(first.held).toBe(true);
    expect(released).toEqual([]);
    await first.release();
    expect(released).toEqual(['client']);
  });

  it('refuses a second production process against the same database', async () => {
    const { pool } = fakeDatabase();
    await claimSingleProcess(pool, { production: true, warn: vi.fn() });
    await expect(claimSingleProcess(pool, { production: true, warn: vi.fn() })).rejects.toThrow(
      /another Lupin API is already running against this database/u,
    );
  });

  it('warns, and starts, outside production', async () => {
    const { pool } = fakeDatabase();
    await claimSingleProcess(pool, { production: false, warn: vi.fn() });
    const warn = vi.fn();
    const second = await claimSingleProcess(pool, { production: false, warn });
    expect(second.held).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('one API process'));
  });
});
