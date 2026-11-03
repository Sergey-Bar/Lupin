import { describe, expect, it } from 'vitest';
import {
  GithubActionRequestSchema,
  GithubInboxQuerySchema,
  GithubPullItemSchema,
} from './github.js';

describe('GithubInboxQuerySchema', () => {
  it('defaults to open items, fifty at a time', () => {
    expect(GithubInboxQuerySchema.parse({})).toMatchObject({ state: 'open', limit: 50 });
  });

  it('bounds the page size and refuses an unknown state', () => {
    expect(GithubInboxQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(GithubInboxQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(GithubInboxQuerySchema.safeParse({ state: 'deleted' }).success).toBe(false);
    expect(GithubInboxQuerySchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('reads the triage filters', () => {
    expect(
      GithubInboxQuerySchema.parse({
        review: 'changes_requested',
        checks: 'failure',
        staleDays: '14',
      }),
    ).toMatchObject({ review: 'changes_requested', checks: 'failure', staleDays: 14 });
  });
});

describe('GithubPullItemSchema', () => {
  it('accepts a pull request with nothing known about its checks', () => {
    const item = {
      id: 'a',
      projectId: 'p',
      projectName: 'Service',
      repository: 'octo/service',
      number: 3,
      title: 'Fix',
      author: null,
      state: 'open',
      draft: false,
      htmlUrl: null,
      headBranch: 'fix',
      baseBranch: 'main',
      labels: [],
      reviewDecision: null,
      checksState: null,
      mergeableState: null,
      requestedReviewers: [],
      openedAt: '2026-10-01T00:00:00.000Z',
      lastActivityAt: '2026-10-02T00:00:00.000Z',
      additions: 1,
      deletions: 0,
      headSha: null,
    };
    expect(GithubPullItemSchema.parse(item)).toEqual(item);
  });
});

describe('GithubActionRequestSchema', () => {
  it('requires a target, and takes the merge method only for a merge', () => {
    expect(
      GithubActionRequestSchema.safeParse({
        action: 'merge',
        projectId: '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11',
        number: 4,
        sha: 'abcdef1',
        method: 'squash',
      }).success,
    ).toBe(true);
    expect(GithubActionRequestSchema.safeParse({ action: 'merge', number: 4 }).success).toBe(false);
    expect(
      GithubActionRequestSchema.safeParse({
        action: 'merge',
        projectId: '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11',
        number: 4,
        sha: 'abcdef1',
        method: 'fast-forward',
      }).success,
    ).toBe(false);
  });

  it('refuses a merge with no head sha, because a stale view must not merge new commits', () => {
    expect(
      GithubActionRequestSchema.safeParse({
        action: 'merge',
        projectId: '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11',
        number: 4,
      }).success,
    ).toBe(false);
  });

  it('refuses an action it does not know', () => {
    expect(
      GithubActionRequestSchema.safeParse({
        action: 'delete-repository',
        projectId: '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11',
        number: 4,
      }).success,
    ).toBe(false);
  });
});

describe('repository actions', () => {
  const projectId = '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11';

  it('protects a branch from the project alone: the default branch is the server’s to know', () => {
    expect(
      GithubActionRequestSchema.safeParse({ action: 'protectBranch', projectId }).success,
    ).toBe(true);
  });

  it('creates a release from a tag, drafts and pre-releases off by default', () => {
    const parsed = GithubActionRequestSchema.parse({
      action: 'createRelease',
      projectId,
      tag: 'v1.2.0',
    });
    expect(parsed).toMatchObject({ draft: false, prerelease: false });
  });

  it('refuses a release with no tag, or a tag that is not a plausible ref', () => {
    for (const tag of ['', ' ', 'has space', 'a'.repeat(300), '../x']) {
      expect(
        GithubActionRequestSchema.safeParse({ action: 'createRelease', projectId, tag }).success,
        JSON.stringify(tag),
      ).toBe(false);
    }
  });
});
