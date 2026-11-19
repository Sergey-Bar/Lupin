/**
 * How a commit's tests went, for the pull-request comment.
 *
 * Every run of the project on the commit (`RunRepository.runsForCommit`), each test's newest
 * result across them, and the workspace quarantine, read through `excusesRun` — the function the gate and
 * `lupin test` use — so the comment, the gate and the CI job say the same thing.
 */

import { storedTestIdentity } from '@lupin/shared-contracts';
import { failureSignature } from '@lupin/reporting';
import {
  excusesRun,
  quarantineMatches,
  type QuarantineMatch,
} from '../execution/quarantine-excusal.js';
import type { ExecutionTestResult } from '../execution/types.js';
import type { RunRepository, TestRecord } from '../repositories/run-repository.js';

export interface CommitTests {
  /** The newest run on the commit. */
  runId: string;
  /** Every run whose results still stand, newest first: shards, separate jobs, re-runs. */
  runIds: string[];
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  /** Errors outside any test; any one means the run is never excused. */
  reportErrors: number;
  /** Whether the run is excused: every failure quarantined, and something passed. */
  excused: boolean;
  /** Failed tests an approved entry excuses. */
  quarantinedFailures: string[];
  /** Failed tests nothing excuses. */
  failures: string[];
  /** Tests that passed only on a retry and that no entry, approved or pending, names. */
  flakyUnquarantined: string[];
  /** Failures nothing excuses whose cause has no triage label. */
  unlabelledFailures: number;
}

export async function commitTests(
  deps: {
    repository: Pick<RunRepository, 'runsForCommit' | 'listTestsForRuns'>;
    quarantined: () => Promise<readonly QuarantineMatch[]>;
    /** Errors outside any test in the run's canonical result (`reportErrors`). */
    reportErrors: (runId: string) => Promise<number>;
    /** The workspace's labelled failure signatures; absent, none are labelled. */
    labelledSignatures?: () => Promise<ReadonlySet<string>>;
  },
  projectId: string,
  commit: string,
): Promise<CommitTests | null> {
  const { runIds, records } = await standingResults(deps.repository, projectId, commit);
  const runId = runIds[0];
  if (runId === undefined) return null;
  const tests: ExecutionTestResult[] = records.map((record) => ({
    id: record.id,
    title: record.title,
    file: record.file,
    stableId: record.stableId,
    status: record.status === 'queued' || record.status === 'running' ? 'unknown' : record.status,
  }));
  const entries = await deps.quarantined();
  let reportErrors = 0;
  for (const id of runIds) reportErrors += await deps.reportErrors(id);
  const failedTests = tests.filter(
    (test) => test.status === 'failed' || test.status === 'timed_out',
  );
  const { excused, excusal } = excusesRun(
    {
      tests,
      projectId,
      summary: { ...summaryOf(tests), durationMs: null },
      error:
        reportErrors === 0
          ? null
          : { code: 'REPORT_ERROR', message: 'The report has errors outside its tests' },
    },
    entries,
  );
  const excusedIds = new Set(excusal.tests);
  const labelled = (await deps.labelledSignatures?.()) ?? new Set<string>();
  const unlabelledFailures = records.filter(
    (record) =>
      (record.status === 'failed' || record.status === 'timed_out') &&
      !excusedIds.has(record.stableId) &&
      !labelled.has(
        failureSignature(record.errorMessage ?? `${record.status} with no message`).signature,
      ),
  ).length;
  const named = (test: ExecutionTestResult) =>
    entries.some(
      (entry) =>
        (entry.status === 'pending' || entry.status === 'approved') &&
        quarantineMatches(entry, test, projectId),
    );
  return {
    runId,
    runIds,
    total: tests.length,
    passed: tests.filter((test) => test.status === 'passed').length,
    failed: failedTests.length,
    flaky: tests.filter((test) => test.status === 'flaky').length,
    reportErrors,
    excused,
    quarantinedFailures: failedTests
      .map(storedTestIdentity)
      .filter((identity) => excusedIds.has(identity))
      .sort(),
    failures: failedTests
      .map(storedTestIdentity)
      .filter((identity) => !excusedIds.has(identity))
      .sort(),
    flakyUnquarantined: tests
      .filter((test) => test.status === 'flaky' && !named(test))
      .map(storedTestIdentity)
      .sort(),
    unlabelledFailures,
  };
}

/** At most this many runs on one commit are read: a matrix wider than this is not a pipeline. */
const MAX_RUNS_PER_COMMIT = 50;

/**
 * Each test's newest result across the commit's runs. Shards hold different tests, so all of them
 * count; a re-run repeats tests, so its result replaces the older one. A run every one of whose
 * results was replaced no longer stands, and neither do its report errors. A run with no tests
 * at all stands, so an upload that broke before any test still fails the gate.
 */
async function standingResults(
  repository: Pick<RunRepository, 'runsForCommit' | 'listTestsForRuns'>,
  projectId: string,
  commit: string,
) {
  const runs = await repository.runsForCommit(projectId, commit, MAX_RUNS_PER_COMMIT);
  const byRun = await repository.listTestsForRuns(runs.map((run) => run.id));
  const seen = new Set<string>();
  const records: TestRecord[] = [];
  const runIds: string[] = [];
  for (const run of runs) {
    const tests = byRun.get(run.id) ?? [];
    const fresh = tests.filter((test) => !seen.has(test.stableId));
    for (const test of fresh) seen.add(test.stableId);
    records.push(...fresh);
    if (fresh.length > 0 || tests.length === 0) runIds.push(run.id);
  }
  return { runIds, records };
}

function summaryOf(tests: readonly ExecutionTestResult[]) {
  const count = (...statuses: ExecutionTestResult['status'][]) =>
    tests.filter((test) => statuses.includes(test.status)).length;
  return {
    total: tests.length,
    passed: count('passed'),
    failed: count('failed', 'timed_out'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    blocked: count('blocked'),
    unknown: count('unknown'),
  };
}

/**
 * The gate's reason for a commit whose tests failed or were never sent, or `null`. A commit with
 * no test results fails: a gate that passes on no evidence prints "Gate passed" for a job whose
 * report step broke. A job that only sends scans says so with `allowNoTests` (`lupin gate
 * --allow-no-tests`). Quarantined failures are excused, as they are everywhere else; errors
 * outside any test are never excused (REL-8).
 */
export function testsGateReason(
  tests: CommitTests | null,
  options: { allowNoTests?: boolean } = {},
): string | null {
  if (tests === null || (tests.total === 0 && tests.reportErrors === 0)) {
    return options.allowNoTests === true
      ? null
      : 'No test results were uploaded for this commit, so its tests were not checked';
  }
  if (tests.excused) return null;
  const failing = tests.failures.length;
  if (failing > 0) {
    const shown = tests.failures.slice(0, 3).join(', ');
    const more = failing > 3 ? `, and ${String(failing - 3)} more` : '';
    return `${String(failing)} failing ${failing === 1 ? 'test' : 'tests'} on this commit: ${shown}${more}`;
  }
  if (tests.reportErrors > 0) {
    return `The test report for this commit has ${String(tests.reportErrors)} error(s) outside any test`;
  }
  return null;
}
