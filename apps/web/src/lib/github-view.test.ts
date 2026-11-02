import { describe, expect, it } from 'vitest';
import type { GithubPullItem } from '@lupin/shared-contracts';
import {
  bucketOf,
  countBuckets,
  primaryActionOf,
  sortByAttention,
  statusOf,
} from './github-view.js';

function pull(overrides: Partial<GithubPullItem> = {}): GithubPullItem {
  return {
    id: 'a',
    projectId: 'p',
    projectName: 'Service',
    repository: 'octo/service',
    number: 1,
    title: 'Change',
    author: 'amy',
    state: 'open',
    draft: false,
    htmlUrl: null,
    headBranch: 'feature',
    baseBranch: 'main',
    labels: [],
    reviewDecision: 'review_required',
    checksState: 'success',
    mergeableState: 'clean',
    requestedReviewers: [],
    openedAt: '2026-10-01T00:00:00.000Z',
    lastActivityAt: '2026-10-02T00:00:00.000Z',
    additions: 1,
    deletions: 1,
    headSha: 'abcdef1',
    ...overrides,
  };
}

describe('bucketOf', () => {
  it('is ready only when approved, green and GitHub says it can merge', () => {
    expect(bucketOf(pull({ reviewDecision: 'approved' }))).toBe('ready');
    expect(bucketOf(pull({ reviewDecision: 'approved', mergeableState: 'has_hooks' }))).toBe(
      'ready',
    );
    // A failing non-required check ("unstable") does not stop a merge.
    expect(bucketOf(pull({ reviewDecision: 'approved', mergeableState: 'unstable' }))).toBe(
      'ready',
    );
    // No CI at all is not a failure.
    expect(bucketOf(pull({ reviewDecision: 'approved', checksState: null }))).toBe('ready');
  });

  it('is not ready when it is approved but GitHub cannot say it will merge', () => {
    for (const mergeableState of ['blocked', 'behind', 'unknown', null]) {
      expect(
        bucketOf(pull({ reviewDecision: 'approved', mergeableState })),
        String(mergeableState),
      ).toBe('waiting');
    }
    expect(bucketOf(pull({ reviewDecision: 'approved', checksState: 'pending' }))).toBe('waiting');
  });

  it('is blocked by a requested change, a failing check or a conflict, even when approved', () => {
    expect(bucketOf(pull({ reviewDecision: 'changes_requested' }))).toBe('blocked');
    expect(bucketOf(pull({ checksState: 'failure' }))).toBe('blocked');
    expect(bucketOf(pull({ reviewDecision: 'approved', mergeableState: 'dirty' }))).toBe('blocked');
  });

  it('puts drafts and finished work aside before anything else', () => {
    expect(bucketOf(pull({ draft: true, checksState: 'failure' }))).toBe('draft');
    expect(bucketOf(pull({ state: 'merged', checksState: 'failure' }))).toBe('done');
    expect(bucketOf(pull({ state: 'closed' }))).toBe('done');
  });

  it('waits on reviewers by default', () => {
    expect(bucketOf(pull())).toBe('waiting');
  });
});

describe('sortByAttention', () => {
  it('lists what can be merged, then what is stuck, then what waits, then drafts, keeping order within a group', () => {
    const items = [
      pull({ id: 'w1', draft: false }),
      pull({ id: 'd1', draft: true }),
      pull({ id: 'b1', checksState: 'failure' }),
      pull({ id: 'r1', reviewDecision: 'approved' }),
      pull({ id: 'b2', reviewDecision: 'changes_requested' }),
      pull({ id: 'r2', reviewDecision: 'approved' }),
    ];
    expect(sortByAttention(items).map((item) => item.id)).toEqual([
      'r1',
      'r2',
      'b1',
      'b2',
      'w1',
      'd1',
    ]);
    // The input is not mutated.
    expect(items[0]?.id).toBe('w1');
  });
});

describe('countBuckets', () => {
  it('counts every bucket, including the empty ones', () => {
    expect(
      countBuckets([
        pull({ reviewDecision: 'approved' }),
        pull({ checksState: 'failure' }),
        pull(),
      ]),
    ).toEqual({ ready: 1, blocked: 1, waiting: 1, draft: 0, done: 0 });
  });
});

describe('statusOf', () => {
  it('names the problem first, so a blocked row says why', () => {
    const status = statusOf(
      pull({
        reviewDecision: 'review_required',
        checksState: 'failure',
        mergeableState: 'dirty',
      }),
    );
    expect(status).toMatchObject({ bucket: 'blocked', headline: 'Blocked', tone: 'danger' });
    expect(status.reasons).toEqual(['Merge conflicts', 'Checks failing', 'Needs review']);
  });

  it('says what a ready pull request has going for it', () => {
    expect(statusOf(pull({ reviewDecision: 'approved' }))).toEqual({
      bucket: 'ready',
      headline: 'Ready to merge',
      tone: 'success',
      reasons: ['Approved', 'Checks passing'],
    });
  });

  it('reports a branch that fell behind and a check still running', () => {
    const status = statusOf(
      pull({ reviewDecision: 'approved', checksState: 'pending', mergeableState: 'behind' }),
    );
    expect(status.headline).toBe('Waiting');
    expect(status.reasons).toEqual(['Checks running', 'Behind base', 'Approved']);
  });

  it('asks nothing of finished work except to remember what was decided', () => {
    expect(
      statusOf(pull({ state: 'merged', reviewDecision: 'review_required', checksState: null })),
    ).toMatchObject({ headline: 'Merged', tone: 'outline', reasons: [] });
    expect(
      statusOf(pull({ state: 'closed', reviewDecision: 'approved', checksState: null })),
    ).toMatchObject({ headline: 'Closed', reasons: ['Approved'] });
  });

  it('is a draft before it is anything else', () => {
    expect(statusOf(pull({ draft: true, checksState: 'failure' }))).toMatchObject({
      headline: 'Draft',
      tone: 'outline',
    });
  });
});

describe('primaryActionOf', () => {
  it('offers a merge for what is ready and an update for what fell behind, nothing else', () => {
    expect(primaryActionOf(pull({ reviewDecision: 'approved' }))).toBe('merge');
    expect(primaryActionOf(pull({ mergeableState: 'behind' }))).toBe('updateBranch');
    expect(primaryActionOf(pull())).toBeNull();
    expect(primaryActionOf(pull({ checksState: 'failure' }))).toBeNull();
    expect(primaryActionOf(pull({ draft: true, mergeableState: 'behind' }))).toBeNull();
    expect(primaryActionOf(pull({ state: 'merged' }))).toBeNull();
  });
});
