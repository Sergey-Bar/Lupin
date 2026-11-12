import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { evidenceDomains, maxSeverityFor } from '../execution/evidence-domains.js';
import { defaultPolicy } from '../execution/quality-gate.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { evidenceDomainsFor } from './gate-evidence.js';

/** Evidence-backed gate domains (plan task 16), decided and read from the real graph. */
const POLICY = defaultPolicy('ws-1');

describe('evidenceDomains', () => {
  it('leaves a domain out when nothing was uploaded for it', () => {
    expect(evidenceDomains({}, POLICY)).toEqual({});
    expect(evidenceDomains({ k6: [] }, POLICY)).toEqual({});
  });

  it('fails security on a high SARIF finding or a failed ZAP scan, and passes below it', () => {
    expect(evidenceDomains({ sarif: ['medium', 'low'] }, POLICY)).toEqual({ security: 'passed' });
    expect(evidenceDomains({ sarif: ['high'] }, POLICY)).toEqual({ security: 'failed' });
    expect(evidenceDomains({ zap: [{ failed: false }, { failed: true }] }, POLICY)).toEqual({
      security: 'failed',
    });
  });

  it('reads the threshold from the policy rule for the domain', () => {
    const strict = {
      ...POLICY,
      rules: [
        {
          domain: 'accessibility' as const,
          required: true,
          maxSeverity: 'medium' as const,
          requiredArtifactKinds: [],
        },
      ],
    };
    expect(maxSeverityFor(strict, 'accessibility')).toBe('medium');
    expect(maxSeverityFor(strict, 'security')).toBe('high');
    expect(evidenceDomains({ axe: ['medium'] }, strict)).toEqual({ accessibility: 'failed' });
    expect(evidenceDomains({ axe: ['medium'] }, POLICY)).toEqual({ accessibility: 'passed' });
  });

  it('fails performance on a crossed k6 threshold and is unknown on an unmeasured one', () => {
    expect(evidenceDomains({ k6: ['passed', 'passed'] }, POLICY)).toEqual({
      performance: 'passed',
    });
    expect(evidenceDomains({ k6: ['passed', 'unknown'] }, POLICY)).toEqual({
      performance: 'unknown',
    });
    expect(evidenceDomains({ k6: ['unknown', 'failed'] }, POLICY)).toEqual({
      performance: 'failed',
    });
  });
});

const NOW = new Date('2026-11-12T12:00:00.000Z');
const COMMIT = 'abc1234def';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function project(db: MigratedDb, workspaceId: string): Promise<string> {
  const [row] = await db
    .insert(schema.projects)
    .values({ workspaceId, name: 'app', slug: `app-${workspaceId}`, defaultBranch: 'main' })
    .returning({ id: schema.projects.id });
  return row?.id ?? '';
}

async function report(
  db: MigratedDb,
  workspaceId: string,
  projectId: string,
  format: string,
  severities: string[],
) {
  const [row] = await db
    .insert(schema.healthReports)
    .values({
      workspaceId,
      projectId,
      branch: 'main',
      commitSha: COMMIT,
      source: 'ci',
      format,
      toolKey: format,
      findingCount: severities.length,
    })
    .returning({ id: schema.healthReports.id });
  for (const [index, severity] of severities.entries()) {
    await db.insert(schema.healthFindings).values({
      workspaceId,
      projectId,
      branch: 'main',
      fingerprint: `${format}-${String(index)}`,
      toolKey: format,
      tool: format,
      ruleId: 'r',
      kind: 'issue',
      severity,
      dimension: format === 'sarif' ? 'security' : 'accessibility',
      message: 'm',
      lastReportId: row?.id ?? null,
    });
  }
}

async function uploadedRun(db: MigratedDb, workspaceId: string, testIds: Record<string, string>) {
  const [row] = await db
    .insert(schema.runs)
    .values({ workspaceId, startedAt: NOW, commit: COMMIT })
    .returning({ id: schema.runs.id });
  for (const [id, status] of Object.entries(testIds)) {
    await db.insert(schema.tests).values({
      id,
      runId: row?.id ?? '',
      workspaceId,
      title: id,
      file: 'f',
      stableId: id,
      status: status as 'passed',
    });
  }
  return row?.id ?? '';
}

describe('evidenceDomainsFor', () => {
  it("reads the commit's SARIF, axe, ZAP and k6 evidence, and never another workspace's", async () => {
    const { db, close } = await migratedDatabase();
    closers.push(close);
    await db
      .insert(schema.workspaces)
      .values({ id: 'ws-2', name: 'ws-2', configPath: '.', createdAt: NOW })
      .onConflictDoNothing();
    const projectId = await project(db, 'ws-1');
    const run = {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: 'ws-1',
      projectId,
      commit: COMMIT,
    };
    expect(await evidenceDomainsFor(db as never, run, POLICY)).toEqual({});
    await report(db, 'ws-1', projectId, 'sarif', ['medium']);
    await report(db, 'ws-1', projectId, 'axe-json', ['critical']);
    await uploadedRun(db, 'ws-1', { 'zap.10202': 'skipped' });
    await uploadedRun(db, 'ws-1', { 'threshold:http_req_duration[p(95)<500]': 'failed' });
    // Another workspace's failing ZAP scan on the same commit counts for nothing here.
    await uploadedRun(db, 'ws-2', { 'zap.40012': 'failed' });
    expect(await evidenceDomainsFor(db as never, run, POLICY)).toEqual({
      security: 'passed',
      accessibility: 'failed',
      performance: 'failed',
    });
    // A run with no commit has no evidence of its own.
    expect(await evidenceDomainsFor(db as never, { ...run, commit: null }, POLICY)).toEqual({});
  });
});
