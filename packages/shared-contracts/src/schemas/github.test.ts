import { describe, expect, it } from 'vitest';
import {
  GithubActionRequestSchema,
  GithubInboxQuerySchema,
  GithubPullItemSchema,
  GithubRepoStateSchema,
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

  it('reads draft as a boolean from the query string, and only from "true" or "false"', () => {
    expect(GithubInboxQuerySchema.parse({ draft: 'true' }).draft).toBe(true);
    expect(GithubInboxQuerySchema.parse({ draft: 'false' }).draft).toBe(false);
    expect(GithubInboxQuerySchema.parse({}).draft).toBeUndefined();
    for (const draft of ['', 'yes', '1', 'TRUE']) {
      expect(GithubInboxQuerySchema.safeParse({ draft }).success, draft).toBe(false);
    }
  });

  it('bounds staleDays and refuses a fraction', () => {
    expect(GithubInboxQuerySchema.parse({ staleDays: '1' }).staleDays).toBe(1);
    expect(GithubInboxQuerySchema.parse({ staleDays: '3650' }).staleDays).toBe(3650);
    for (const staleDays of ['0', '3651', '1.5', 'soon']) {
      expect(GithubInboxQuerySchema.safeParse({ staleDays }).success, staleDays).toBe(false);
    }
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

  /**
   * Every member of the union, each with the field it exists for. A member that kept its
   * discriminator but lost its shape would still parse `{ action }` and silently drop the rest.
   * So each must round-trip its own field, and each must refuse to parse without it.
   */
  const target = { projectId, number: 7 };
  const ACTIONS: { request: Record<string, unknown>; requires: string }[] = [
    { request: { action: 'comment', ...target, body: 'Looks good' }, requires: 'body' },
    { request: { action: 'labels', ...target, labels: ['bug'] }, requires: 'labels' },
    { request: { action: 'assign', ...target, assignees: ['octo'] }, requires: 'assignees' },
    { request: { action: 'close', ...target }, requires: 'number' },
    { request: { action: 'reopen', ...target }, requires: 'number' },
    { request: { action: 'requestReviewers', ...target, reviewers: ['a'] }, requires: 'reviewers' },
    { request: { action: 'review', ...target, event: 'APPROVE' }, requires: 'event' },
    { request: { action: 'merge', ...target, sha: 'abcdef1', method: 'merge' }, requires: 'sha' },
    { request: { action: 'updateBranch', ...target, sha: 'abcdef1' }, requires: 'number' },
    { request: { action: 'rerunWorkflow', projectId, runId: '123' }, requires: 'runId' },
    { request: { action: 'protectBranch', projectId }, requires: 'projectId' },
    { request: { action: 'createRelease', projectId, tag: 'v1.0.0' }, requires: 'tag' },
  ];

  it('keeps every field each action names, for all twelve actions', () => {
    expect(ACTIONS).toHaveLength(12);
    for (const { request } of ACTIONS) {
      expect(GithubActionRequestSchema.parse(request), String(request['action'])).toMatchObject(
        request,
      );
    }
  });

  it('refuses each action without the field it exists for', () => {
    for (const { request, requires } of ACTIONS) {
      const without = Object.fromEntries(Object.entries(request).filter(([k]) => k !== requires));
      expect(
        GithubActionRequestSchema.safeParse(without).success,
        `${String(request['action'])} without ${requires}`,
      ).toBe(false);
    }
  });

  it('bounds the reviewer list, and refuses a run id that is not a number', () => {
    const many = Array.from({ length: 21 }, (_, i) => `user${String(i)}`);
    expect(
      GithubActionRequestSchema.safeParse({ action: 'requestReviewers', ...target, reviewers: [] })
        .success,
    ).toBe(false);
    expect(
      GithubActionRequestSchema.safeParse({
        action: 'requestReviewers',
        ...target,
        reviewers: many,
      }).success,
    ).toBe(false);
    expect(
      GithubActionRequestSchema.safeParse({ action: 'rerunWorkflow', projectId, runId: '12a' })
        .success,
    ).toBe(false);
  });

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

  it('says why a tag with ".." is refused, in words', () => {
    const result = GithubActionRequestSchema.safeParse({
      action: 'createRelease',
      projectId,
      tag: 'v1..2',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'a tag cannot contain ".."',
    );
  });
});

describe('GithubRepoStateSchema', () => {
  const counts = { critical: 0, high: 1, medium: 2, low: 3, truncated: false };
  const base = {
    community: null,
    alerts: { dependabot: counts, codeScanning: counts, secretScanning: counts },
    rateLimit: null,
    syncedAt: '2026-11-01T00:00:00.000Z',
  };

  it('reads all three protection states, and keeps what a protected branch requires', () => {
    const protectedState = { state: 'protected', requiresReview: true, requiresChecks: false };
    expect(GithubRepoStateSchema.parse({ ...base, protection: protectedState }).protection).toEqual(
      protectedState,
    );
    for (const state of ['unprotected', 'unavailable']) {
      expect(GithubRepoStateSchema.parse({ ...base, protection: { state } }).protection).toEqual({
        state,
      });
    }
  });

  it('refuses a protected branch that does not say what it requires, or an unknown state', () => {
    expect(
      GithubRepoStateSchema.safeParse({ ...base, protection: { state: 'protected' } }).success,
    ).toBe(false);
    expect(
      GithubRepoStateSchema.safeParse({ ...base, protection: { state: 'locked' } }).success,
    ).toBe(false);
    expect(GithubRepoStateSchema.safeParse({ ...base, protection: {} }).success).toBe(false);
  });

  it('reads an alert feed the token cannot see as unavailable, never as zero', () => {
    const parsed = GithubRepoStateSchema.parse({
      ...base,
      protection: { state: 'unprotected' },
      alerts: { ...base.alerts, secretScanning: { unavailable: 'forbidden' } },
    });
    expect(parsed.alerts.secretScanning).toEqual({ unavailable: 'forbidden' });
  });
});
