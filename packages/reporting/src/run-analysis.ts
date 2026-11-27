import type { RunAnalysis, RunCause } from '@lupin/shared-contracts';
import { failureSignature } from './failure-clusters.js';

/**
 * What changed in one run against the run before it, and the causes of its failures (plan
 * 1795712849115 task 13). Pure: the caller chooses the two runs.
 *
 * - A **new failure** failed here and did not fail in the earlier run (it passed there, or was
 *   not in it). **Fixed** failed there and passed here. **Still failing** failed in both.
 * - **Newly slow** is a test that passed in both runs and took at least half as long again,
 *   and at least 500 ms longer, so a 10 ms test going to 20 ms is not news.
 * - **Causes** group this run's failures by `failureSignature`, the normalisation the stored
 *   clusters use, so a cause here and a cause on the Tests page are the same cause.
 *
 * **Test output is untrusted.** A failure message can say anything, including text addressed to
 * a model reading it. It is never interpolated into a sentence: `sentence` and `summary` are
 * built from counts and the error type alone (itself cut to an identifier), and the message is
 * only ever carried as `sample`, quoted, stripped of control characters and cut short.
 */

export interface AnalysedTest {
  key: string;
  title: string;
  status: string;
  durationMs: number | null;
  message: string | null;
  stack?: string | null;
}

export interface AnalysedRun {
  id: string;
  tests: readonly AnalysedTest[];
}

const FAILED = new Set(['failed', 'timed_out', 'timedOut']);
const SLOWER_RATIO = 1.5;
const SLOWER_MIN_MS = 500;
const SAMPLE_LENGTH = 200;
const MAX_LISTED = 50;

const ref = (test: AnalysedTest) => ({ key: test.key, title: test.title });

/** Code points that end or hide a line: C0 and C1 controls, DEL, and the two Unicode breaks. */
function isControl(char: string): boolean {
  // A UTF-16 unit is enough: every code point tested below is in the Basic Multilingual Plane.
  const code = char.charCodeAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/** Quoted, single-line and short: a message is evidence to show, never text to follow. */
export function quotedSample(message: string | null | undefined): string {
  const flat = [...(message ?? '')]
    .map((char) => (isControl(char) ? ' ' : char))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  const cut = flat.length > SAMPLE_LENGTH ? `${flat.slice(0, SAMPLE_LENGTH - 1)}…` : flat;
  return cut === '' ? '' : `"${cut.replaceAll('"', "'")}"`;
}

/** The error type as an identifier, or `null`: `TimeoutError`, never prose. */
function safeErrorType(errorType: string | null): string | null {
  return errorType !== null && /^[A-Za-z_$][\w$.]{0,63}$/u.test(errorType) ? errorType : null;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

function causesOf(failed: readonly AnalysedTest[], earlier: Set<string>): RunCause[] {
  const bySignature = new Map<string, { errorType: string | null; tests: AnalysedTest[] }>();
  for (const test of failed) {
    const { signature, errorType } = failureSignature(test.message ?? '', test.stack ?? null);
    const entry = bySignature.get(signature) ?? { errorType, tests: [] };
    entry.tests.push(test);
    bySignature.set(signature, entry);
  }
  return [...bySignature.entries()]
    .map(([signature, { errorType, tests }]) => {
      const type = safeErrorType(errorType);
      const isNew = !tests.some((test) => earlier.has(test.key));
      const what = type === null ? 'one cause' : `one ${type}`;
      return {
        signature,
        errorType: type,
        tests: tests.length,
        newInThisRun: isNew,
        sample: quotedSample(tests[0]?.message),
        sentence: `${plural(tests.length, 'failed test')} from ${what}${
          isNew ? ', first seen in this run' : ', also failing in the run before'
        }.`,
      };
    })
    .sort((a, b) => b.tests - a.tests || a.signature.localeCompare(b.signature));
}

function summaryOf(analysis: Omit<RunAnalysis, 'summary'>): string {
  if (analysis.comparedTo === null) {
    const failed = analysis.newFailures.length;
    return failed === 0
      ? 'No earlier run to compare with, and nothing failed.'
      : `No earlier run to compare with: ${plural(failed, 'test')} failed, from ${plural(analysis.causes.length, 'cause')}.`;
  }
  const parts: string[] = [];
  if (analysis.newFailures.length > 0) {
    const fresh = analysis.causes.filter((cause) => cause.newInThisRun).length;
    parts.push(
      `${plural(analysis.newFailures.length, 'new failure')}` +
        (fresh > 0 ? `, ${plural(fresh, 'new cause')}` : ''),
    );
  }
  if (analysis.fixed.length > 0) parts.push(`${plural(analysis.fixed.length, 'test')} fixed`);
  if (analysis.stillFailing.length > 0) {
    parts.push(`${plural(analysis.stillFailing.length, 'test')} still failing`);
  }
  if (analysis.newlySlow.length > 0) {
    parts.push(`${plural(analysis.newlySlow.length, 'test')} slower`);
  }
  return parts.length === 0
    ? 'Nothing changed since the run before.'
    : `Since the run before: ${parts.join(', ')}.`;
}

export function analyseRun(current: AnalysedRun, previous: AnalysedRun | null): RunAnalysis {
  const before = new Map((previous?.tests ?? []).map((test) => [test.key, test]));
  const failedBefore = new Set(
    [...before.values()].filter((test) => FAILED.has(test.status)).map((test) => test.key),
  );
  const failed = current.tests.filter((test) => FAILED.has(test.status));
  const newFailures = failed.filter((test) => !failedBefore.has(test.key));
  const stillFailing = failed.filter((test) => failedBefore.has(test.key));
  const fixed = current.tests.filter(
    (test) => test.status === 'passed' && failedBefore.has(test.key),
  );
  const newlySlow = current.tests.flatMap((test) => {
    const earlier = before.get(test.key);
    if (test.status !== 'passed' || earlier?.status !== 'passed') return [];
    const nowMs = test.durationMs;
    const beforeMs = earlier.durationMs;
    if (nowMs === null || beforeMs === null || beforeMs < 0) return [];
    return nowMs >= beforeMs * SLOWER_RATIO && nowMs - beforeMs >= SLOWER_MIN_MS
      ? [{ ...ref(test), beforeMs, nowMs }]
      : [];
  });
  const full = {
    runId: current.id,
    comparedTo: previous?.id ?? null,
    newFailures: newFailures.map(ref),
    fixed: fixed.map(ref),
    stillFailing: stillFailing.map(ref),
    newlySlow,
    causes: causesOf(failed, failedBefore),
  };
  // The sentence counts everything; the lists carry the first fifty of each.
  return {
    ...full,
    newFailures: full.newFailures.slice(0, MAX_LISTED),
    fixed: full.fixed.slice(0, MAX_LISTED),
    stillFailing: full.stillFailing.slice(0, MAX_LISTED),
    newlySlow: full.newlySlow.slice(0, MAX_LISTED),
    summary: summaryOf(full),
  };
}
