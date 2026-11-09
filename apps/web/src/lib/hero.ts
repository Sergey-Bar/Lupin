import type { HeroVerdict } from '@lupin/ui';
import type { ReleaseReadinessCard } from './qa.js';

/**
 * The release verdict as the hero says it: one word, the one reason that decided it, and the
 * one place to go next. Pure, so the mapping is a unit test. A verdict nobody measured is
 * "Not measured", never "Ready": an unread gate is not a passing one.
 */
export interface Hero {
  verdict: HeroVerdict;
  word: string;
  reason: string;
  action: { label: string; to: string };
}

export function heroVerdict(card: ReleaseReadinessCard | null): Hero {
  const reasons = card?.reasons ?? [];
  const first = (level: string) => reasons.find((reason) => reason.level === level)?.message;
  switch (card?.verdict) {
    case 'no-go':
      return {
        verdict: 'no-go',
        word: 'No-go',
        reason: first('no-go') ?? first('caution') ?? 'A release gate is failing.',
        action: { label: 'See what is blocking', to: '/dashboard' },
      };
    case 'caution':
      return {
        verdict: 'caution',
        word: 'Caution',
        reason: first('caution') ?? 'A release gate is warning.',
        action: { label: 'Review the warnings', to: '/dashboard' },
      };
    case 'go':
      return {
        verdict: 'go',
        word: 'Ready',
        reason: 'Every release gate passes.',
        action: { label: 'See the runs', to: '/dashboard/runs' },
      };
    default:
      return {
        verdict: 'unknown',
        word: 'Not measured',
        reason: first('unknown') ?? 'No run has been checked against the release gates yet.',
        action: { label: 'Start a run', to: '/dashboard/runner' },
      };
  }
}

/**
 * An area's verdict as the hero says it (Runs, Tests): failing when anything is red, caution
 * when only warnings are left, green otherwise. The reason is the area's own sentence.
 */
export function areaHero(
  counts: { bad: number; warn: number },
  reason: string,
): { verdict: HeroVerdict; word: string; reason: string } {
  if (counts.bad > 0) return { verdict: 'no-go', word: 'Failing', reason };
  if (counts.warn > 0) return { verdict: 'caution', word: 'Caution', reason };
  return { verdict: 'go', word: 'Green', reason };
}

/**
 * One run as the hero says it. While it runs it counts what has reported and what is failing
 * so far, and never shows a verdict; when it ends it settles into Passed or Failed. `failed`
 * is how many tests a "retry what failed" would run (the API's `scope: 'failed'` statuses).
 */
export interface RunHero {
  verdict: HeroVerdict;
  word: string;
  reason: string;
  failed: number;
}

interface HeroRun {
  phase: string;
  outcome: string | null;
  tests?: readonly { status: string }[];
  summary: { total: number; passed: number; failed: number };
}

export function runHero(run: HeroRun): RunHero {
  const { total, passed, failed } = run.summary;
  const named = (run.tests ?? []).filter(
    (test) => test.status === 'failed' || test.status === 'timed_out',
  ).length;
  if (run.outcome === null) {
    return {
      verdict: 'unknown',
      word: 'Running',
      reason: `${String(passed + failed)} of ${String(total)} tests reported${failed > 0 ? ` · ${String(failed)} failing so far` : ''}`,
      failed,
    };
  }
  if (run.outcome === 'passed') {
    return {
      verdict: 'go',
      word: 'Passed',
      reason: `All ${String(total)} tests passed.`,
      failed: 0,
    };
  }
  return {
    verdict: 'no-go',
    word: 'Failed',
    reason:
      total > 0
        ? `${String(failed)} of ${String(total)} tests failed.`
        : 'The run failed before it reported tests.',
    failed: named,
  };
}
