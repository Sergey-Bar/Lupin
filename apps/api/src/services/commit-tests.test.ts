import { describe, expect, it } from 'vitest';
import { failureSignature } from '@lupin/reporting';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import type { TestRecord } from '../repositories/run-repository.js';
import type { QuarantineMatch } from '../execution/quarantine-excusal.js';
import { commitTests, testsGateReason, type CommitTests } from './commit-tests.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const COMMIT = 'abcdef1234567';

async function seed(
  statuses: Record<string, TestRecord['status']>,
  startedAt: string,
  id: string,
  repository = new InMemoryRunRepository(),
) {
  await repository.upsertRun({
    id,
    workspaceId: 'ws',
    phase: 'complete',
    outcome: 'failed',
    startedAt,
    finishedAt: startedAt,
    status: 'failed',
    total: Object.keys(statuses).length,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: null,
    branch: 'main',
    commitSha: COMMIT,
    projectId: PROJECT,
    triggeredBy: 'ci',
  });
  for (const [title, status] of Object.entries(statuses)) {
    await repository.upsertTest({
      id: title,
      runId: id,
      title,
      file: 'a.spec.ts',
      stableId: `a.spec.ts › ${title}`,
      status,
      durationMs: 1,
      errorCode: null,
      errorMessage: null,
    });
  }
  return repository;
}

const approved = (title: string, status: QuarantineMatch['status'] = 'approved') => ({
  stableId: `a.spec.ts › ${title}`,
  testTitle: title,
  testFile: 'a.spec.ts',
  status,
});

describe('commitTests', () => {
  it('reads the latest run of the project on the commit through the gate’s own rule', async () => {
    const repository = await seed(
      { pays: 'failed', lists: 'passed', retries: 'flaky', waits: 'flaky' },
      '2026-10-26T10:00:00.000Z',
      'run-1',
    );
    const tests = await commitTests(
      {
        repository,
        quarantined: async () => [approved('pays'), approved('waits', 'pending')],
        reportErrors: async () => 0,
      },
      PROJECT,
      COMMIT,
    );
    expect(tests).toEqual({
      runId: 'run-1',
      runIds: ['run-1'],
      total: 4,
      passed: 1,
      failed: 1,
      flaky: 2,
      reportErrors: 0,
      excused: true,
      quarantinedFailures: ['a.spec.ts › pays'],
      failures: [],
      // `waits` has a pending entry: someone has acted on it, so it is not listed.
      flakyUnquarantined: ['a.spec.ts › retries'],
      // Its one failure is excused, so there is nothing left to label.
      unlabelledFailures: 0,
    });
  });

  it('counts the unexcused failures whose cause nobody labelled', async () => {
    const repository = await seed(
      { pays: 'failed', refunds: 'failed', lists: 'passed' },
      '2026-10-26T10:00:00.000Z',
      'r-labels',
    );
    // `seed` writes no message; a failure with none has the signature of "failed with no message".
    const tests = await commitTests(
      {
        repository,
        quarantined: async () => [],
        reportErrors: async () => 0,
        labelledSignatures: async () => new Set<string>(),
      },
      PROJECT,
      COMMIT,
    );
    expect(tests?.unlabelledFailures).toBe(2);
    const labelled = await commitTests(
      {
        repository,
        quarantined: async () => [],
        reportErrors: async () => 0,
        labelledSignatures: async () =>
          new Set([failureSignature('failed with no message').signature]),
      },
      PROJECT,
      COMMIT,
    );
    expect(labelled?.unlabelledFailures).toBe(0);
  });

  it('never excuses a run with an error outside its tests', async () => {
    const repository = await seed(
      { pays: 'failed', lists: 'passed' },
      '2026-10-26T10:00:00.000Z',
      'r',
    );
    const tests = await commitTests(
      { repository, quarantined: async () => [approved('pays')], reportErrors: async () => 1 },
      PROJECT,
      COMMIT,
    );
    expect(tests?.excused).toBe(false);
  });

  it('judges every shard on the commit, and lets a re-run replace the result it repeats', async () => {
    const repository = await seed({ pays: 'failed' }, '2026-10-26T10:00:00.000Z', 'shard-1');
    await seed({ lists: 'passed' }, '2026-10-26T10:05:00.000Z', 'shard-2', repository);
    const deps = { repository, quarantined: async () => [], reportErrors: async () => 0 };
    // The later shard does not hide the earlier one's failure.
    expect(await commitTests(deps, PROJECT, COMMIT)).toMatchObject({
      runId: 'shard-2',
      runIds: ['shard-2', 'shard-1'],
      total: 2,
      passed: 1,
      failures: ['a.spec.ts › pays'],
    });
    // Re-running the failed shard green replaces its result.
    await seed({ pays: 'passed' }, '2026-10-26T10:10:00.000Z', 'shard-1-retry', repository);
    expect(await commitTests(deps, PROJECT, COMMIT)).toMatchObject({
      total: 2,
      passed: 2,
      failures: [],
    });
  });

  it('counts report errors only from runs whose results still stand', async () => {
    const repository = await seed({ pays: 'passed' }, '2026-10-26T10:00:00.000Z', 'old');
    await seed({ pays: 'passed' }, '2026-10-26T10:05:00.000Z', 'new', repository);
    const errors = async (runId: string) => (runId === 'old' ? 1 : 0);
    const deps = { repository, quarantined: async () => [], reportErrors: errors };
    expect((await commitTests(deps, PROJECT, COMMIT))?.reportErrors).toBe(0);
  });

  it('answers null for a commit with no run, and for another project', async () => {
    const repository = await seed({ pays: 'passed' }, '2026-10-26T10:00:00.000Z', 'r');
    const deps = { repository, quarantined: async () => [], reportErrors: async () => 0 };
    expect(await commitTests(deps, PROJECT, 'fffffff')).toBeNull();
    expect(await commitTests(deps, '22222222-2222-4222-8222-222222222222', COMMIT)).toBeNull();
  });
});

describe('testsGateReason (REL-8)', () => {
  const base: CommitTests = {
    runId: 'r',
    runIds: ['r'],
    total: 5,
    passed: 5,
    failed: 0,
    flaky: 0,
    reportErrors: 0,
    excused: false,
    quarantinedFailures: [],
    failures: [],
    flakyUnquarantined: [],
    unlabelledFailures: 0,
  };

  it('fails a commit whose own run has failures nothing excuses, naming them', () => {
    expect(testsGateReason({ ...base, failed: 1, failures: ['cart › totals the basket'] })).toBe(
      '1 failing test on this commit: cart › totals the basket',
    );
    expect(testsGateReason({ ...base, failed: 5, failures: ['a', 'b', 'c', 'd', 'e'] })).toBe(
      '5 failing tests on this commit: a, b, c, and 2 more',
    );
  });

  it('passes a green run and a run excused by quarantine', () => {
    expect(testsGateReason(base)).toBeNull();
    expect(testsGateReason({ ...base, excused: true, failures: ['a'] })).toBeNull();
  });

  it('fails a commit with no test results, unless the job says it sends none', () => {
    expect(testsGateReason(null)).toBe(
      'No test results were uploaded for this commit, so its tests were not checked',
    );
    expect(testsGateReason({ ...base, total: 0, passed: 0 })).toBe(
      'No test results were uploaded for this commit, so its tests were not checked',
    );
    expect(testsGateReason(null, { allowNoTests: true })).toBeNull();
  });

  it('fails a report with errors outside any test, which is never excused', () => {
    expect(testsGateReason({ ...base, reportErrors: 2 })).toMatch(/2 error\(s\) outside any test/u);
  });
});
