import type { AttentionItem } from './attention.js';

/**
 * What the home page shows, chosen so a reader never has to triage a list.
 *
 * One thing first, at most two after it, and the rest counted rather than drawn. The ranking
 * is `rankAttention`'s; this only decides how much of it reaches the screen at once, because a
 * list of eight equal-weight rows is eight decisions and the page should hand over one.
 */
export interface Focus {
  first: AttentionItem | undefined;
  next: AttentionItem[];
  hidden: AttentionItem[];
}

export const NEXT_LIMIT = 2;

export function focusOf(items: readonly AttentionItem[]): Focus {
  const [first, ...rest] = items;
  return { first, next: rest.slice(0, NEXT_LIMIT), hidden: rest.slice(NEXT_LIMIT) };
}

/** A greeting by the reader's local hour. Personal without asking for anything. */
export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function spelled(count: number): string {
  return WORDS[count] ?? String(count);
}

/** One sentence under the greeting: how much there is, and what changed since last time. */
export function focusSentence(total: number, fresh: number): string {
  if (total === 0) return 'Nothing needs you. Go build something.';
  const shape =
    total === 1 ? 'One thing needs you.' : `One thing first, then ${spelled(total - 1)} more.`;
  if (fresh === 0) return shape;
  return `${shape} ${String(fresh)} ${fresh === 1 ? 'is' : 'are'} new since your last visit.`;
}
