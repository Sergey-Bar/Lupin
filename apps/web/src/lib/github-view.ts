import type { GithubPullItem } from '@lupin/shared-contracts';

/**
 * Where a pull request stands for the person looking at the queue, as pure functions.
 *
 * The buckets answer "what can I do with this", not "what state is it in":
 *
 *  - `ready`   approved, checks not failing or pending, and GitHub says it can merge. Merge it.
 *  - `blocked` a requested change, a failing check or a conflict. Someone has to fix it.
 *  - `waiting` everything else that is open: a review or a check is still to come, or GitHub has
 *              not said whether it can merge. Not knowing is never `ready`.
 *  - `draft`   not asking for attention yet.
 *  - `done`    merged or closed.
 */
export type Bucket = 'ready' | 'blocked' | 'waiting' | 'draft' | 'done';

/** GitHub's `mergeable_state` values that allow a merge. `unstable` is non-required checks failing. */
const MERGEABLE = new Set(['clean', 'has_hooks', 'unstable']);

export function bucketOf(pr: GithubPullItem): Bucket {
  if (pr.state !== 'open') return 'done';
  if (pr.draft) return 'draft';
  if (
    pr.reviewDecision === 'changes_requested' ||
    pr.checksState === 'failure' ||
    pr.mergeableState === 'dirty'
  ) {
    return 'blocked';
  }
  if (
    pr.reviewDecision === 'approved' &&
    pr.checksState !== 'pending' &&
    pr.mergeableState !== null &&
    MERGEABLE.has(pr.mergeableState)
  ) {
    return 'ready';
  }
  return 'waiting';
}

const ORDER: readonly Bucket[] = ['ready', 'blocked', 'waiting', 'draft', 'done'];

/** Ready first, then blocked, then waiting; stable, so the server's recency order holds inside. */
export function sortByAttention(items: readonly GithubPullItem[]): GithubPullItem[] {
  return items
    .map((item, index) => ({ item, index, rank: ORDER.indexOf(bucketOf(item)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

export function countBuckets(items: readonly GithubPullItem[]): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { ready: 0, blocked: 0, waiting: 0, draft: 0, done: 0 };
  for (const item of items) counts[bucketOf(item)] += 1;
  return counts;
}
