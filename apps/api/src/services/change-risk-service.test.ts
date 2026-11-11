import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { AGENT_SIGNATURES } from '@lupin/reporting';
import { PullRequestRiskHistorySchema, PullRequestRiskSchema } from '@lupin/shared-contracts';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  assessPullRequestRisk,
  pullRequestRisk,
  riskFactsOf,
  type ChangeRiskOptions,
  type RiskFacts,
} from './change-risk-service.js';
import type { CommitTests } from './commit-tests.js';
import { recordDiffGuard } from './diff-guard-service.js';
import type { GateResult } from './repo-health-service.js';

/**
 * A pull request's change risk against the real migration graph: the inputs read from the
 * synced pull request, CODEOWNERS, the failure correlations and diff-guard; one stored
 * assessment per head; and the workspace wall.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-11-11T09:00:00.000Z');
const HEAD = 'b'.repeat(40);

async function setup(extra: { health?: Record<string, unknown>; codeowners?: string } = {}) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId: 'ws-1',
      name: 'Service',
      slug: 'service',
      defaultBranch: 'main',
      profile: { health: extra.health ?? {} },
      settings: extra.codeowners === undefined ? {} : { health: { codeowners: extra.codeowners } },
    })
    .returning({ id: schema.projects.id });
  let clock = NOW.getTime();
  const options: ChangeRiskOptions = {
    db: db as never,
    workspaceId: 'ws-1',
    now: () => new Date((clock += 1000)),
  };
  return { db, options, projectId: (project as { id: string }).id };
}

async function insertPr(
  db: MigratedDb,
  projectId: string,
  seed: Partial<typeof schema.pullRequests.$inferInsert> = {},
) {
  await db.insert(schema.pullRequests).values({
    workspaceId: 'ws-1',
    projectId,
    externalId: '12',
    number: 12,
    state: 'open',
    authorLogin: 'alice-person',
    title: 'Cart totals',
    openedAt: NOW,
    lastActivityAt: NOW,
    headSha: HEAD,
    changedPaths: ['packages/db/migrations/0040_cart.sql', 'src/cart.ts'],
    changedFiles: 2,
    additions: 800,
    deletions: 100,
    testsTouched: false,
    humanApprovalCount: 0,
    attribution: 'agent-authored',
    aiAgent: 'claude-code',
    attributionConfidence: 0.95,
    attributionVersion: AGENT_SIGNATURES.version,
    ...seed,
  });
}

const facts = (overrides: Partial<RiskFacts> = {}): RiskFacts => ({
  pullRequest: 12,
  commit: HEAD,
  branch: 'feature/cart',
  diffCoverage: 92,
  findings: { high: 0, critical: 0 },
  tests: { runId: 'run-1', total: 40, failed: 0, unexcusedFlaky: 0 },
  evalRegressions: null,
  attribution: null,
  ...overrides,
});

describe('assessPullRequestRisk', () => {
  it('reads the synced pull request, the blast radius and diff-guard, and stores the assessment', async () => {
    const { db, options, projectId } = await setup({
      codeowners: '/packages/db/ @acme/data @dana\n/src/ @acme/shop',
    });
    await insertPr(db, projectId);
    await db.insert(schema.testFailureCorrelations).values({
      id: 'c-1',
      workspaceId: 'ws-1',
      testStableId: 'cart › totals',
      sourceFilePath: 'src/cart.ts',
      failureCount: 3,
      totalOccurrences: 10,
      windowStartDate: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await recordDiffGuard(options, projectId, {
      commit: HEAD,
      base: 'origin/main',
      report: {
        version: 'diff-guard/1',
        findings: [{ kind: 'skip-added', path: 'src/cart.test.ts', line: 3, side: 'head' }],
        counts: { 'skip-added': 1 },
        filesChecked: 3,
        truncated: false,
      },
    });
    const assessed = PullRequestRiskSchema.parse(
      await assessPullRequestRisk(options, projectId, facts()),
    );
    expect(assessed.risk.level).toBe('critical');
    expect(assessed.risk.factors[0]).toMatchObject({
      id: 'test-tampering',
      evidence: `diff-guard:${HEAD}`,
    });
    expect(assessed.risk.factors.map((factor) => factor.id)).toContain('blast-radius');
    expect(assessed.blastRadius).toMatchObject({
      sensitiveAreas: [{ area: 'migrations', count: 1 }],
      teams: ['@acme/data', '@acme/shop'],
      individualOwners: 1,
      linkedTests: [{ testStableId: 'cart › totals', failures: 3, files: 1 }],
      truncated: false,
    });
    expect(JSON.stringify(assessed)).not.toContain('dana');
    const rows = await db.select().from(schema.pullRequestRiskAssessments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ prNumber: 12, headSha: HEAD, level: 'critical' });
  });

  it('reads a pull request the sync never read as unknown authorship, and says what is missing', async () => {
    const { options, projectId } = await setup();
    const assessed = await assessPullRequestRisk(
      options,
      projectId,
      facts({ diffCoverage: null, tests: null }),
    );
    expect(assessed.risk.level).toBe('unknown');
    expect(assessed.risk.missing).toEqual(['tests', 'diff-coverage']);
    expect(assessed.risk.factors.map((factor) => `${factor.kind}:${factor.id}`)).toEqual(
      expect.arrayContaining(['missing:attribution', 'missing:tampering']),
    );
    expect(assessed.blastRadius).toBeNull();
  });

  it('prefers the gate’s fresh attribution over a stale stored one', async () => {
    const { db, options, projectId } = await setup();
    await insertPr(db, projectId, { attribution: 'human', aiAgent: null });
    const assessed = await assessPullRequestRisk(
      options,
      projectId,
      facts({ attribution: { attribution: 'agent-authored', agent: 'codex' } }),
    );
    expect(assessed.risk.factors[0]?.detail).toBe('Written by an agent (codex).');
  });

  it('applies the project’s required evidence', async () => {
    const { db, options, projectId } = await setup({
      health: { risk: { require: ['tests', 'diff-coverage', 'tampering'] } },
    });
    await insertPr(db, projectId, { attribution: 'human', humanApprovalCount: 1, additions: 10 });
    const assessed = await assessPullRequestRisk(options, projectId, facts());
    expect(assessed.risk.missing).toEqual(['tampering']);
    expect(assessed.risk.level).toBe('unknown');
  });

  it('keeps one assessment per head, the later one winning, and a history across heads', async () => {
    const { db, options, projectId } = await setup();
    await insertPr(db, projectId);
    await assessPullRequestRisk(options, projectId, facts({ commit: 'a'.repeat(40) }));
    await assessPullRequestRisk(options, projectId, facts({ diffCoverage: 10 }));
    await assessPullRequestRisk(options, projectId, facts({ diffCoverage: 95 }));
    expect(await db.select().from(schema.pullRequestRiskAssessments)).toHaveLength(2);
    const read = PullRequestRiskHistorySchema.parse(await pullRequestRisk(options, projectId, 12));
    expect(read.latest?.headSha).toBe(HEAD);
    expect(read.history.map((entry) => entry.headSha)).toEqual([HEAD, 'a'.repeat(40)]);
    expect(read.latest?.risk.factors.some((factor) => factor.id === 'diff-coverage')).toBe(false);
  });

  it('keeps only the most recent assessments of a project', async () => {
    const { db, options, projectId } = await setup();
    const bounded = { ...options, retention: 1 };
    await assessPullRequestRisk(bounded, projectId, facts({ pullRequest: 1 }));
    await assessPullRequestRisk(bounded, projectId, facts({ pullRequest: 2 }));
    const rows = await db.select().from(schema.pullRequestRiskAssessments);
    expect(rows.map((row) => row.prNumber)).toEqual([2]);
  });

  it('answers no assessment for a pull request nobody gated', async () => {
    const { options, projectId } = await setup();
    expect(await pullRequestRisk(options, projectId, 99)).toEqual({
      pullRequest: 99,
      latest: null,
      history: [],
    });
  });
});

describe('riskFactsOf', () => {
  const tests: CommitTests = {
    runId: 'run-9',
    total: 30,
    passed: 27,
    failed: 3,
    flaky: 2,
    reportErrors: 1,
    excused: false,
    quarantinedFailures: ['q'],
    failures: ['a', 'b'],
    flakyUnquarantined: ['f'],
    unlabelledFailures: 0,
  };
  const gate = (overrides: Partial<GateResult> = {}): GateResult =>
    ({
      branch: 'feature/cart',
      verdict: {},
      grade: { dimensions: [{ dimension: 'security', measured: true, letter: 'A' }] },
      added: [{ severity: 'high' }, { severity: 'critical' }, { severity: 'low' }],
      diffCoverage: { ratio: 0.735 },
      delivery: null,
      aiGovernance: { attribution: 'ai-assisted', agent: 'copilot' },
      evals: {
        gateOnEvals: false,
        suites: [{ verdict: 'fail' }, { verdict: 'pass' }],
        commit: null,
        onDefaultBranch: false,
      },
      agentRuntime: null,
      ...overrides,
    }) as unknown as GateResult;

  it('reads the gate’s own measurements, counting unexcused failures and report errors', () => {
    expect(riskFactsOf(gate(), tests, HEAD, 12)).toEqual({
      pullRequest: 12,
      commit: HEAD,
      branch: 'feature/cart',
      diffCoverage: 73.5,
      findings: { high: 1, critical: 1 },
      tests: { runId: 'run-9', total: 30, failed: 3, unexcusedFlaky: 1 },
      evalRegressions: 1,
      attribution: { attribution: 'ai-assisted', agent: 'copilot' },
    });
  });

  it('reads an unmeasured security dimension as no scan, not as no findings', () => {
    const unscanned = gate({
      grade: { dimensions: [{ dimension: 'security', measured: false }] },
    } as unknown as Partial<GateResult>);
    expect(riskFactsOf(unscanned, null, HEAD, 12)).toMatchObject({
      findings: null,
      tests: null,
    });
  });

  it('reads no diff coverage, no evals and no governance check as absent', () => {
    expect(
      riskFactsOf(gate({ diffCoverage: null, evals: null, aiGovernance: null }), tests, HEAD, 12),
    ).toMatchObject({ diffCoverage: null, evalRegressions: null, attribution: null });
  });
});

describe('workspace isolation', () => {
  it('is another workspace’s project, as far as another workspace can tell, not found', async () => {
    const { db, options, projectId } = await setup();
    await insertPr(db, projectId);
    const other = { ...options, workspaceId: 'ws-2' };
    await expect(assessPullRequestRisk(other, projectId, facts())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await db.select().from(schema.pullRequestRiskAssessments)).toEqual([]);
    await assessPullRequestRisk(options, projectId, facts());
    await expect(pullRequestRisk(other, projectId, 12)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never reads another workspace’s pull request or failure correlations', async () => {
    const { db, options, projectId } = await setup();
    await db.insert(schema.testFailureCorrelations).values({
      id: 'c-foreign',
      workspaceId: 'ws-2',
      testStableId: 'foreign › test',
      sourceFilePath: 'src/cart.ts',
      failureCount: 9,
      totalOccurrences: 9,
      windowStartDate: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await insertPr(db, projectId, { workspaceId: 'ws-1' });
    const assessed = await assessPullRequestRisk(options, projectId, facts());
    expect(assessed.blastRadius?.linkedTests).toEqual([]);
  });
});
