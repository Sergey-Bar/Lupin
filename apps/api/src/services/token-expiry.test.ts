import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { eq } from 'drizzle-orm';
import { migratedDatabase } from '../test-support/migrated-database.js';
import {
  ROTATION_GRACE_MS,
  authenticateToken,
  createAccessToken,
  rotateAccessToken,
} from './access-service.js';

/** Token expiry and rotation (plan task 6), against the real migration graph. */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  return { db, options: { db: db as never, workspaceId: 'ws-1' } };
}

describe('an access token that expires', () => {
  it('authenticates until it expires, and never after', async () => {
    const { db, options } = await setup();
    const { token, summary } = await createAccessToken(
      options,
      { name: 'ci', role: 'operator', expiresInDays: 30 },
      'token:admin',
    );
    expect(summary.expiresAt).not.toBeNull();
    expect(await authenticateToken(options, token)).toMatchObject({ role: 'operator' });
    // Every instant at or before now counts as expired.
    for (const ago of [0, 1, 60_000, 86_400_000]) {
      await db
        .update(schema.accessTokens)
        .set({ expiresAt: new Date(Date.now() - ago) })
        .where(eq(schema.accessTokens.id, summary.id));
      expect(await authenticateToken(options, token), `expired ${String(ago)}ms ago`).toBeNull();
    }
  });

  it('never expires without an expiry', async () => {
    const { options } = await setup();
    const { token, summary } = await createAccessToken(
      options,
      { name: 'forever', role: 'viewer' },
      'token:admin',
    );
    expect(summary.expiresAt).toBeNull();
    expect(await authenticateToken(options, token)).not.toBeNull();
  });
});

describe('rotating an access token', () => {
  it('issues a working successor and ends the old one after the grace period', async () => {
    const { db, options } = await setup();
    const old = await createAccessToken(
      options,
      { name: 'ci', role: 'operator', expiresInDays: 30 },
      'token:admin',
    );
    const now = new Date();
    const successor = await rotateAccessToken(options, old.summary.id, 'token:admin', now);
    expect(successor.summary).toMatchObject({ name: 'ci', role: 'operator' });
    expect(await authenticateToken(options, successor.token)).not.toBeNull();
    // Still works inside the grace period.
    expect(await authenticateToken(options, old.token)).not.toBeNull();
    const [row] = await db
      .select()
      .from(schema.accessTokens)
      .where(eq(schema.accessTokens.id, old.summary.id));
    expect(row?.expiresAt?.getTime()).toBe(now.getTime() + ROTATION_GRACE_MS);
  });

  it("refuses another workspace's token", async () => {
    const { db, options } = await setup();
    const old = await createAccessToken(options, { name: 'ci', role: 'viewer' }, 'token:admin');
    await expect(
      rotateAccessToken({ db: db as never, workspaceId: 'ws-2' }, old.summary.id, 'x'),
    ).rejects.toThrow(/No live token/u);
  });
});
