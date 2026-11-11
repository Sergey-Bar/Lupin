/**
 * One API process per database (ADR-006), checked rather than assumed (ledger MNT-175).
 *
 * Several parts of the API keep state in the process and are correct only while there is one:
 * the rate limiters (`middleware/rate-limit.ts`), the one-admin-change-at-a-time queue in
 * `routes/members.ts`, the GitHub App token cache and the OIDC discovery cache. Distributing
 * that state is not the plan, so the assumption is made a fact instead: the process holds a
 * session advisory lock for its whole life. A second API against the same database is refused
 * in production, where a split budget or two concurrent admin changes are real, and warned
 * about elsewhere, where the E2E suite deliberately boots one beside another.
 */

/** Distinct from the migration lock in `@lupin/db`, so a migration never blocks a boot. */
export const SINGLE_PROCESS_LOCK_KEY = '7310418551972644221';

interface LockClient {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

export interface SingleProcessClaim {
  /** Whether this process holds the lock; `false` only outside production. */
  held: boolean;
  /** Gives the lock and its connection back, at shutdown. */
  release(): Promise<void>;
}

export async function claimSingleProcess(
  pool: { connect(): Promise<LockClient> },
  options: { production: boolean; warn: (message: string) => void },
): Promise<SingleProcessClaim> {
  const client = await pool.connect();
  const result = await client.query('SELECT pg_try_advisory_lock($1) AS granted', [
    SINGLE_PROCESS_LOCK_KEY,
  ]);
  if (result.rows[0]?.['granted'] === true) {
    return {
      held: true,
      release: async () => {
        await client
          .query('SELECT pg_advisory_unlock($1)', [SINGLE_PROCESS_LOCK_KEY])
          .catch(() => undefined);
        client.release();
      },
    };
  }
  client.release();
  const message =
    'another Lupin API is already running against this database. Lupin runs one API process ' +
    'per database (ADR-006): its rate limits and admin-change queue are held in the process.';
  if (options.production) throw new Error(message);
  options.warn(`${message} Starting anyway outside production; keep to one API process.`);
  return { held: false, release: async () => undefined };
}
