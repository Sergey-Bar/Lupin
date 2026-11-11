import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { integrationMaturity, listIntegrationMaturity } from './maturity.js';

describe('integration maturity registry', () => {
  it('lists capability levels without claiming unverified integrations', () => {
    const items = listIntegrationMaturity();
    expect(items.length).toBeGreaterThan(5);
    expect(items.find((item) => item.id === 'playwright-test')?.level).toBe('L4');
    expect(integrationMaturity('missing')).toBeNull();
    expect(integrationMaturity('junit')?.evidenceStatus).toBe('verified');
  });

  it('names an adapter for every framework an agent can queue (ledger MNT-182)', () => {
    // The agent adapters are the source: each queues a job for one framework. The registry
    // listed k6 and Bruno with no adapter and no capability long after both were built.
    const agents = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents');
    const frameworks = ['browser-adapter.ts', 'api-adapter.ts', 'load-adapter.ts'].map(
      (file) => readFileSync(path.join(agents, file), 'utf8').match(/framework: '([^']+)'/u)?.[1],
    );
    expect(frameworks).toEqual(['playwright', 'bruno', 'k6']);
    for (const id of ['bruno', 'k6']) {
      const row = integrationMaturity(id);
      expect(row?.adapterVersion, id).not.toBe('none');
      expect(row?.capabilities.length, id).toBeGreaterThan(0);
      expect(row?.evidenceStatus, id).toBe('implemented');
    }
  });

  it('describes JUnit by the adapter that reads it, not the legacy upload', () => {
    expect(integrationMaturity('junit')).toMatchObject({
      adapterVersion: 'junit-xml',
      evidence: ['reporter-upload-door'],
    });
  });
});
