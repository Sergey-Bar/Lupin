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
  return {
    bucket,
    headline: FINISHED_HEADLINE[pr.state] ?? base.headline,
    tone: pr.state === 'open' ? base.tone : 'outline',
    reasons: reasonsOf(pr),
  };
}

/** What a finished pull request is called, whatever bucket it sorted into. */
const FINISHED_HEADLINE: Partial<Record<GithubPullItem['state'], string>> = {
  merged: 'Merged',
  closed: 'Closed',
};

/**
 * Why a pull request has the status it has, worst first: one rule per reason, in the order a
 * reader should meet them. A rule marked `open` only applies while the pull request is open;
 * what was decided (approved, changes requested) still reads true afterwards.
 */
const REASON_RULES: ReadonlyArray<{
  open: boolean;
  text: string;
  when: (pr: GithubPullItem) => boolean;
}> = [
  { open: true, text: 'Merge conflicts', when: (pr) => pr.mergeableState === 'dirty' },
  {
    open: false,
    text: 'Changes requested',
    when: (pr) => pr.reviewDecision === 'changes_requested',
  },
  { open: true, text: 'Checks failing', when: (pr) => pr.checksState === 'failure' },
  { open: true, text: 'Checks running', when: (pr) => pr.checksState === 'pending' },
  { open: true, text: 'Needs review', when: (pr) => pr.reviewDecision === 'review_required' },
  { open: true, text: 'Behind base', when: (pr) => pr.mergeableState === 'behind' },
  { open: false, text: 'Approved', when: (pr) => pr.reviewDecision === 'approved' },
  { open: true, text: 'Checks passing', when: (pr) => pr.checksState === 'success' },
  { open: true, text: 'No checks', when: (pr) => pr.checksState === null },
];

function reasonsOf(pr: GithubPullItem): string[] {
  const open = pr.state === 'open';
  return REASON_RULES.filter((rule) => (open || !rule.open) && rule.when(pr)).map(
    (rule) => rule.text,
  );
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

export interface Gate {
  name: 'Review' | 'Checks' | 'Merge';
  label: string;
  tone: 'success' | 'danger' | 'warning' | 'outline';
}

/**
 * The three things between an open pull request and a merge, each in a word and a tone: has
 * someone approved it, are the checks green, and will GitHub let it merge. Finished work has
 * none left to pass, so it has no gates.
 */
export function gatesOf(pr: GithubPullItem): Gate[] {
  if (pr.state !== 'open') return [];
  return [
    { name: 'Review', ...(REVIEW_GATE[pr.reviewDecision ?? ''] ?? NO_REVIEW_REQUIRED) },
    { name: 'Checks', ...(CHECKS_GATE[pr.checksState ?? ''] ?? NO_CHECKS) },
    { name: 'Merge', ...mergeGate(pr.mergeableState) },
  ];
}

type GateWords = Pick<Gate, 'label' | 'tone'>;

const REVIEW_GATE: Record<string, GateWords> = {
  approved: { label: 'Approved', tone: 'success' },
  changes_requested: { label: 'Changes requested', tone: 'danger' },
  review_required: { label: 'Waiting for a review', tone: 'warning' },
};
const NO_REVIEW_REQUIRED: GateWords = { label: 'No review required', tone: 'outline' };

const CHECKS_GATE: Record<string, GateWords> = {
  success: { label: 'Passing', tone: 'success' },
  failure: { label: 'Failing', tone: 'danger' },
  pending: { label: 'Running', tone: 'warning' },
};
const NO_CHECKS: GateWords = { label: 'No checks', tone: 'outline' };
function mergeGate(state: string | null): Pick<Gate, 'label' | 'tone'> {
  switch (state) {
    case 'clean':
    case 'has_hooks':
      return { label: 'Can merge', tone: 'success' };
    case 'unstable':
      return { label: 'Can merge, a check that is not required fails', tone: 'warning' };
    case 'dirty':
      return { label: 'Conflicts with the base branch', tone: 'danger' };
    case 'behind':
      return { label: 'Behind the base branch', tone: 'warning' };
    case 'blocked':
      return { label: 'Blocked by the branch rules', tone: 'danger' };
    default:
      return { label: 'GitHub has not said yet', tone: 'outline' };
  }
}

/**
 * What to do about a pull request, as one or two sentences: the answer a reader would otherwise
 * assemble from three badges. It names the gate that is in the way, never a guess.
 */
export function adviceOf(pr: GithubPullItem): string {
  if (pr.state === 'merged') return 'This pull request was merged.';
  if (pr.state === 'closed') return 'This pull request was closed without being merged.';
  if (pr.draft) return 'A draft: it is not asking for a review yet.';
  const bucket = bucketOf(pr);
  if (bucket === 'ready') return 'Approved, green and mergeable. Nothing is in the way.';
  const gates = gatesOf(pr);
  const wanted = bucket === 'blocked' ? 'danger' : 'warning';
  const sentences = gates
    .filter((gate) => gate.tone === wanted || (bucket === 'blocked' && gate.tone === 'warning'))
    .map((gate) => `${gate.name}: ${gate.label.charAt(0).toLowerCase()}${gate.label.slice(1)}.`);
  if (bucket === 'blocked') return `Needs work before it can merge. ${sentences.join(' ')}`;
  return sentences.length === 0
    ? 'GitHub has not said yet whether this can merge.'
    : `Not ready yet. ${sentences.join(' ')}`;
}
