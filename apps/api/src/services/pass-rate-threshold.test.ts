import { describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { passRateThreshold } from './scan-history-service.js';

/** The default gate sets the readiness bar (ledger MNT-203). */
describe('the readiness pass-rate threshold', () => {
  it("follows the installation default, a workspace's own beats it, another's never counts", async () => {
    const { db, close } = await migratedDatabase();
    try {
      const options = { db, workspaceId: 'ws-1' } as never;
      const gate = (id: string, threshold: number, workspaceId?: string) => ({
        id,
        name: id,
        passRateThreshold: threshold,
        updatedAt: new Date(),
        ...(workspaceId === undefined ? {} : { workspaceId }),
      });
      expect(await passRateThreshold(options, 'p')).toBe(95);
      await db
        .insert(schema.qualityGateConfig)
        .values([gate('global', 80), gate('theirs', 60, 'ws-2')]);
      expect(await passRateThreshold(options, 'p')).toBe(80);
      await db.insert(schema.qualityGateConfig).values(gate('own', 70, 'ws-1'));
      expect(await passRateThreshold(options, 'p')).toBe(70);
    } finally {
      await close();
    }
  });
});
