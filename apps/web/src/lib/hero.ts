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
        action: { label: 'See what is warning', to: '/dashboard' },
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
