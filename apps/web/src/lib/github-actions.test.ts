import { describe, expect, it } from 'vitest';
import type { GithubIssueItem, GithubPullItem } from '@lupin/shared-contracts';
import {
  actionsFor,
  buildActions,
  needsInput,
  parseList,
  subjectOfIssue,
  subjectOfPull,
  subjectOfRepo,
  validate,
  type Form,
} from './github-actions.js';

const pull = (overrides: Partial<GithubPullItem> = {}): GithubPullItem => ({
  id: 'a',
  projectId: 'p1',
  projectName: 'Service',
  repository: 'octo/service',
  number: 7,
  title: 'Change',
  author: 'amy',
  state: 'open',
  draft: false,
  htmlUrl: null,
  headBranch: 'feature',
  baseBranch: 'main',
  labels: ['bug'],
  reviewDecision: 'approved',
  checksState: 'success',
  mergeableState: 'clean',
  requestedReviewers: [],
  openedAt: '2026-10-01T00:00:00.000Z',
  lastActivityAt: '2026-10-02T00:00:00.000Z',
  additions: 1,
  deletions: 1,
  headSha: 'abcdef1',
  ...overrides,
});

const issue = (overrides: Partial<GithubIssueItem> = {}): GithubIssueItem => ({
  id: 'i',
  projectId: 'p1',
  projectName: 'Service',
  repository: 'octo/service',
  number: 9,
  title: 'Crash',
  author: 'amy',
  state: 'open',
  labels: ['bug'],
  assignees: ['bob'],
  commentCount: 0,
  htmlUrl: null,
  openedAt: '2026-10-01T00:00:00.000Z',
  lastActivityAt: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

const empty: Form = {
  text: '',
  method: 'squash',
  event: 'APPROVE',
  tag: '',
  name: '',
  releaseType: 'release',
};

describe('parseList', () => {
  it('splits on commas and spaces, trims, drops blanks and repeats, and a leading @', () => {
    expect(parseList(' bug, p1  ,, bug  @amy ')).toEqual(['bug', 'p1', 'amy']);
    expect(parseList('')).toEqual([]);
  });

  it('keeps the case a name was written in', () => {
    expect(parseList('Needs-Triage')).toEqual(['Needs-Triage']);
  });
});

describe('actionsFor', () => {
  it('offers an open pull request every pull request action', () => {
    expect(actionsFor(subjectOfPull(pull()))).toEqual([
      'merge',
      'updateBranch',
      'review',
      'requestReviewers',
      'comment',
      'labels',
      'close',
    ]);
  });

  it('does not offer a merge of a draft, and offers only a reopen and a comment on a closed one', () => {
    expect(actionsFor(subjectOfPull(pull({ draft: true })))).not.toContain('merge');
    expect(actionsFor(subjectOfPull(pull({ state: 'closed' })))).toEqual(['reopen', 'comment']);
    expect(actionsFor(subjectOfPull(pull({ state: 'merged' })))).toEqual(['comment']);
  });

  it('offers an issue its own set, and reopen instead of close once it is closed', () => {
    expect(actionsFor(subjectOfIssue(issue()))).toEqual(['comment', 'labels', 'assign', 'close']);
    expect(actionsFor(subjectOfIssue(issue({ state: 'closed' })))).toEqual([
      'comment',
      'labels',
      'assign',
      'reopen',
    ]);
  });
});

describe('needsInput', () => {
  it('is true for the actions that take text or a choice', () => {
    for (const kind of [
      'comment',
      'labels',
      'assign',
      'review',
      'requestReviewers',
      'merge',
    ] as const) {
      expect(needsInput(kind), kind).toBe(true);
    }
    for (const kind of ['close', 'reopen', 'updateBranch'] as const) {
      expect(needsInput(kind), kind).toBe(false);
    }
  });
});

describe('buildActions', () => {
  const subject = subjectOfPull(pull());

  it('builds a merge naming the head commit the person looked at, and the method chosen', () => {
    expect(buildActions('merge', [subject], { ...empty, method: 'rebase' })).toEqual([
      { action: 'merge', projectId: 'p1', number: 7, sha: 'abcdef1', method: 'rebase' },
    ]);
  });

  it('builds one action per item, in the order given', () => {
    const actions = buildActions('close', [subject, subjectOfIssue(issue())], empty);
    expect(actions.map((action) => 'number' in action && action.number)).toEqual([7, 9]);
  });

  it('builds comments, labels, assignees, reviewers and reviews from the form', () => {
    expect(buildActions('comment', [subject], { ...empty, text: 'Thanks' })[0]).toMatchObject({
      action: 'comment',
      body: 'Thanks',
    });
    expect(buildActions('labels', [subject], { ...empty, text: 'bug, p1' })[0]).toMatchObject({
      action: 'labels',
      labels: ['bug', 'p1'],
    });
    expect(buildActions('assign', [subject], { ...empty, text: '@amy bob' })[0]).toMatchObject({
      action: 'assign',
      assignees: ['amy', 'bob'],
    });
    expect(
      buildActions('requestReviewers', [subject], { ...empty, text: 'carol' })[0],
    ).toMatchObject({
      action: 'requestReviewers',
      reviewers: ['carol'],
    });
    expect(
      buildActions('review', [subject], {
        ...empty,
        event: 'REQUEST_CHANGES',
        text: 'Add tests',
      })[0],
    ).toMatchObject({ action: 'review', event: 'REQUEST_CHANGES', body: 'Add tests' });
  });

  it('leaves the review body out when there is none, and an empty label list means "clear them"', () => {
    const review = buildActions('review', [subject], empty)[0];
    expect(review).not.toHaveProperty('body');
    expect(buildActions('labels', [subject], empty)[0]).toMatchObject({ labels: [] });
  });

  it('builds an update-branch that is only as new as the commit the person saw', () => {
    expect(buildActions('updateBranch', [subject], empty)).toEqual([
      { action: 'updateBranch', projectId: 'p1', number: 7, sha: 'abcdef1' },
    ]);
  });
});

describe('validate', () => {
  const one = [subjectOfPull(pull())];
  const issueOnly = [subjectOfIssue(issue())];

  it('wants text for a comment, reviewers for a review request, and a person for an assignment-free list', () => {
    expect(validate('comment', one, empty)).toMatch(/comment/u);
    expect(validate('comment', one, { ...empty, text: '   ' })).toMatch(/comment/u);
    expect(validate('comment', one, { ...empty, text: 'ok' })).toBeNull();
    expect(validate('requestReviewers', one, empty)).toMatch(/reviewer/u);
    expect(validate('requestReviewers', one, { ...empty, text: 'carol' })).toBeNull();
    // Clearing labels or assignees is a real thing to do.
    expect(validate('labels', one, empty)).toBeNull();
    expect(validate('assign', issueOnly, empty)).toBeNull();
  });

  it('wants a body for a change request or a comment review, but not for an approval', () => {
    expect(validate('review', one, { ...empty, event: 'REQUEST_CHANGES' })).toMatch(/Explain/u);
    expect(validate('review', one, { ...empty, event: 'COMMENT' })).toMatch(/Explain/u);
    expect(validate('review', one, { ...empty, event: 'APPROVE' })).toBeNull();
  });

  it('refuses a merge with no head commit to name, and a merge of more than one', () => {
    expect(validate('merge', [subjectOfPull(pull({ headSha: null }))], empty)).toMatch(/sync/u);
    expect(validate('merge', [...one, ...one], empty)).toMatch(/one at a time/u);
    expect(validate('merge', one, empty)).toBeNull();
  });
});

describe('repository actions', () => {
  const repo = subjectOfRepo({ projectId: 'p1', name: 'Service', repository: 'octo/service' });

  it('offers a repository protecting its default branch and a release', () => {
    expect(actionsFor(repo)).toEqual(['protectBranch', 'createRelease']);
  });

  it('has no number, and says so rather than inventing one', () => {
    expect(repo).toMatchObject({ kind: 'repo', repository: 'octo/service', number: 0 });
  });

  it('builds a protection request from the project alone', () => {
    expect(buildActions('protectBranch', [repo], empty)).toEqual([
      { action: 'protectBranch', projectId: 'p1' },
    ]);
  });

  it('builds a release with the tag, name, notes and type', () => {
    const form: Form = {
      ...empty,
      tag: 'v1.2.0',
      name: 'Version 1.2',
      text: 'Notes',
      releaseType: 'prerelease',
    };
    expect(buildActions('createRelease', [repo], form)).toEqual([
      {
        action: 'createRelease',
        projectId: 'p1',
        tag: 'v1.2.0',
        name: 'Version 1.2',
        notes: 'Notes',
        draft: false,
        prerelease: true,
      },
    ]);
    expect(
      buildActions('createRelease', [repo], { ...form, releaseType: 'draft' })[0],
    ).toMatchObject({
      draft: true,
      prerelease: false,
    });
  });

  it('leaves out a blank name and blank notes', () => {
    const built = buildActions('createRelease', [repo], { ...empty, tag: 'v1' })[0];
    expect(built).not.toHaveProperty('name');
    expect(built).not.toHaveProperty('notes');
  });

  it('wants a valid tag, and one release at a time', () => {
    expect(validate('createRelease', [repo], empty)).toMatch(/tag/u);
    expect(validate('createRelease', [repo], { ...empty, tag: 'has space' })).toMatch(/tag/u);
    expect(validate('createRelease', [repo], { ...empty, tag: 'v1.0.0' })).toBeNull();
    expect(validate('createRelease', [repo, repo], { ...empty, tag: 'v1' })).toMatch(
      /one repository/u,
    );
    expect(validate('protectBranch', [repo, repo], empty)).toBeNull();
  });

  it('needs no input for protection, and some for a release', () => {
    expect(needsInput('protectBranch')).toBe(false);
    expect(needsInput('createRelease')).toBe(true);
  });
});
