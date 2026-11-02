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

export interface PullStatus {
  bucket: Bucket;
  /** One word or phrase for the whole row: what a reader would say if asked "so?". */
  headline: string;
  tone: 'success' | 'danger' | 'warning' | 'outline';
  /** Why, worst first. Short enough to read in one line under the headline. */
  reasons: string[];
}

const HEADLINE: Record<Bucket, Pick<PullStatus, 'headline' | 'tone'>> = {
  ready: { headline: 'Ready to merge', tone: 'success' },
  blocked: { headline: 'Blocked', tone: 'danger' },
  waiting: { headline: 'Waiting', tone: 'warning' },
  draft: { headline: 'Draft', tone: 'outline' },
  done: { headline: 'Closed', tone: 'outline' },
};

/**
 * One status and its reasons for a pull request, so a row says what to do about it instead of
 * leaving the reader to combine a review column, a checks column and a mergeable flag.
 *
 * A finished pull request is waiting for nothing, so "needs review" and "no checks" are left
 * out; what was decided (approved, changes requested) still reads true.
 */
export function statusOf(pr: GithubPullItem): PullStatus {
  const bucket = bucketOf(pr);
  const base = HEADLINE[bucket];
  const headline =
    pr.state === 'merged' ? 'Merged' : pr.state === 'closed' ? 'Closed' : base.headline;
  const reasons: string[] = [];
  const open = pr.state === 'open';
  if (open && pr.mergeableState === 'dirty') reasons.push('Merge conflicts');
  if (pr.reviewDecision === 'changes_requested') reasons.push('Changes requested');
  if (open && pr.checksState === 'failure') reasons.push('Checks failing');
  if (open && pr.checksState === 'pending') reasons.push('Checks running');
  if (open && pr.reviewDecision === 'review_required') reasons.push('Needs review');
  if (open && pr.mergeableState === 'behind') reasons.push('Behind base');
  if (pr.reviewDecision === 'approved') reasons.push('Approved');
  if (open && pr.checksState === 'success') reasons.push('Checks passing');
  if (open && pr.checksState === null) reasons.push('No checks');
  return { bucket, headline, tone: pr.state === 'open' ? base.tone : 'outline', reasons };
}

/**
 * The one action worth drawing as a button on the row: merge what is ready, and bring a branch
 * that has fallen behind up to date. Everything else stays in the menu.
 */
export function primaryActionOf(pr: GithubPullItem): 'merge' | 'updateBranch' | null {
  if (pr.state !== 'open' || pr.draft) return null;
  if (bucketOf(pr) === 'ready') return 'merge';
  if (pr.mergeableState === 'behind') return 'updateBranch';
  return null;
}
