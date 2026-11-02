import type { GithubActionRequest, GithubIssueItem, GithubPullItem } from '@lupin/shared-contracts';

/**
 * What a person can do to a pull request or an issue, and how a form becomes the request the
 * API understands. Pure, so the rules are tested without a screen.
 *
 * Whether an action is *allowed* is the server's decision (role, token, branch moved); this only
 * decides what to *offer*, so a button that could never work is not drawn.
 */
export type ActionKind =
  | 'merge'
  | 'updateBranch'
  | 'review'
  | 'requestReviewers'
  | 'comment'
  | 'labels'
  | 'assign'
  | 'close'
  | 'reopen'
  | 'protectBranch'
  | 'createRelease';

/** An item an action is aimed at: the fields every action needs, from a pull request or an issue. */
export interface Subject {
  /** 
epo is a whole repository: it has no number (it is 0) and no state. */
  kind: 'pull' | 'issue' | 'repo';
  projectId: string;
  repository: string;
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  /** The head commit the person looked at. A merge names it. */
  headSha: string | null;
  labels: readonly string[];
  assignees: readonly string[];
  /** What the screen showed, so a confirmation can say what the person is about to override. */
  reviewDecision: GithubPullItem['reviewDecision'];
  checksState: GithubPullItem['checksState'];
  mergeableState: string | null;
}

export function subjectOfPull(pr: GithubPullItem): Subject {
  return {
    kind: 'pull',
    projectId: pr.projectId,
    repository: pr.repository,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    headSha: pr.headSha,
    labels: pr.labels,
    assignees: [],
    reviewDecision: pr.reviewDecision,
    checksState: pr.checksState,
    mergeableState: pr.mergeableState,
  };
}

export function subjectOfIssue(issue: GithubIssueItem): Subject {
  return {
    kind: 'issue',
    projectId: issue.projectId,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    draft: false,
    headSha: null,
    labels: issue.labels,
    assignees: issue.assignees,
    reviewDecision: null,
    checksState: null,
    mergeableState: null,
  };
}

/** A repository as the target of a repository-level action. */
export function subjectOfRepo(repo: {
  projectId: string;
  name: string;
  repository: string | null;
}): Subject {
  return {
    kind: 'repo',
    projectId: repo.projectId,
    repository: repo.repository ?? repo.name,
    number: 0,
    title: repo.name,
    state: 'open',
    draft: false,
    headSha: null,
    labels: [],
    assignees: [],
    reviewDecision: null,
    checksState: null,
    mergeableState: null,
  };
}

/** The actions worth offering for one item, in the order a menu should list them. */
export function actionsFor(subject: Subject): ActionKind[] {
  if (subject.kind === 'repo') return ['protectBranch', 'createRelease'];
  if (subject.kind === 'issue') {
    return ['comment', 'labels', 'assign', subject.state === 'open' ? 'close' : 'reopen'];
  }
  if (subject.state === 'merged') return ['comment'];
  if (subject.state === 'closed') return ['reopen', 'comment'];
  return [
    ...(subject.draft ? [] : (['merge'] as const)),
    'updateBranch',
    'review',
    'requestReviewers',
    'comment',
    'labels',
    'close',
  ];
}

/** Whether the action asks the person for something before it can run. */
export function needsInput(kind: ActionKind): boolean {
  return !(
    kind === 'close' ||
    kind === 'reopen' ||
    kind === 'updateBranch' ||
    kind === 'protectBranch'
  );
}

export interface Form {
  text: string;
  method: 'merge' | 'squash' | 'rebase';
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  /** A release's tag, and its optional title. The notes are 	ext. */
  tag: string;
  name: string;
  releaseType: 'release' | 'prerelease' | 'draft';
}

/** `bug, p1 @amy` as `['bug', 'p1', 'amy']`: split, trimmed, without blanks, repeats or a leading @. */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,]+/u)) {
    const name = part.replace(/^@/u, '').trim();
    if (name !== '') seen.add(name);
  }
  return [...seen];
}

const TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;

/** The reason an action cannot run yet, in a sentence, or `null` when it can. */
export function validate(
  kind: ActionKind,
  subjects: readonly Subject[],
  form: Form,
): string | null {
  switch (kind) {
    case 'comment':
      return form.text.trim() === '' ? 'Write the comment first.' : null;
    case 'requestReviewers':
      return parseList(form.text).length === 0 ? 'Name at least one reviewer.' : null;
    case 'review':
      return form.event !== 'APPROVE' && form.text.trim() === ''
        ? 'Explain the review: a change request or a comment needs words.'
        : null;
    case 'createRelease':
      if (subjects.length !== 1) return 'A release is made in one repository at a time.';
      return TAG.test(form.tag) && !form.tag.includes('..')
        ? null
        : 'Give the release a tag: letters, digits, dots, dashes and slashes, like v1.2.0.';
    case 'merge':
      if (subjects.length !== 1) return 'Pull requests are merged one at a time.';
      return subjects[0]?.headSha === null || subjects[0]?.headSha === undefined
        ? 'No commit to merge yet: wait for the sync to read this pull request.'
        : null;
    default:
      return null;
  }
}

/** The API requests for one action over some items, one request per item. */
export function buildActions(
  kind: ActionKind,
  subjects: readonly Subject[],
  form: Form,
): GithubActionRequest[] {
  return subjects.map((subject): GithubActionRequest => {
    const target = { projectId: subject.projectId, number: subject.number };
    switch (kind) {
      case 'merge':
        return { action: 'merge', ...target, sha: subject.headSha ?? '', method: form.method };
      case 'updateBranch':
        return {
          action: 'updateBranch',
          ...target,
          ...(subject.headSha === null ? {} : { sha: subject.headSha }),
        };
      case 'review':
        return {
          action: 'review',
          ...target,
          event: form.event,
          ...(form.text.trim() === '' ? {} : { body: form.text.trim() }),
        };
      case 'requestReviewers':
        return { action: 'requestReviewers', ...target, reviewers: parseList(form.text) };
      case 'comment':
        return { action: 'comment', ...target, body: form.text.trim() };
      case 'labels':
        return { action: 'labels', ...target, labels: parseList(form.text) };
      case 'assign':
        return { action: 'assign', ...target, assignees: parseList(form.text) };
      case 'close':
        return { action: 'close', ...target };
      case 'reopen':
        return { action: 'reopen', ...target };
      case 'protectBranch':
        return { action: 'protectBranch', projectId: subject.projectId };
      case 'createRelease':
        return {
          action: 'createRelease',
          projectId: subject.projectId,
          tag: form.tag.trim(),
          ...(form.name.trim() === '' ? {} : { name: form.name.trim() }),
          ...(form.text.trim() === '' ? {} : { notes: form.text.trim() }),
          draft: form.releaseType === 'draft',
          prerelease: form.releaseType === 'prerelease',
        };
    }
  });
}
