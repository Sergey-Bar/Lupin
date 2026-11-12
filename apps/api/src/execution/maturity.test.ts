import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPORT_FORMATS } from '@lupin/shared-contracts';
import { integrationMaturity, listIntegrationMaturity, withUploadDoor } from './maturity.js';

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
    const frameworks = [
      'browser-adapter.ts',
      'api-adapter.ts',
      'load-adapter.ts',
      'security-adapter.ts',
    ].map(
      (file) => readFileSync(path.join(agents, file), 'utf8').match(/framework: '([^']+)'/u)?.[1],
    );
    expect(frameworks).toEqual(['playwright', 'bruno', 'k6', 'zap']);
    for (const id of ['bruno', 'k6', 'zap']) {
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

describe('rows derived from the upload door (plan task 20)', () => {
  it('reports every producer the reporter door reads, with import evidence', () => {
    for (const format of REPORT_FORMATS.filter((entry) => entry.spellings.length > 0)) {
      const row = integrationMaturity(format.producer);
      expect(row, format.producer).not.toBeNull();
      expect(row?.capabilities).toContain('import');
      expect(row?.evidence).toContain('reporter-upload-door');
      expect(row?.level).not.toBe('L0');
    }
    // ZAP read as absent while its adapter was live; k6 keeps its execution evidence too.
    expect(integrationMaturity('zap')).toMatchObject({
      level: 'L2',
      evidenceStatus: 'implemented',
    });
    expect(integrationMaturity('k6')?.evidence).toEqual(
      expect.arrayContaining(['load-agent', 'reporter-upload-door']),
    );
    expect(integrationMaturity('zap')?.evidence).toEqual(
      expect.arrayContaining(['security-agent', 'runner-zap-execution', 'reporter-upload-door']),
    );
  });

  it('adds a row for a producer with none, and leaves a door-less table as written', () => {
    const rows = withUploadDoor([], [{ id: 'new-xml', producer: 'newtool', spellings: ['new'] }]);
    expect(rows).toEqual([
      expect.objectContaining({ id: 'newtool', level: 'L2', adapterVersion: 'new-xml' }),
    ]);
    expect(
      withUploadDoor([], [{ id: 'legacy-upload', producer: 'legacy', spellings: [] }]),
    ).toEqual([]);
  });
});
