import { isHumanReviewer } from './delivery-github.js';

/**
 * What the command center derives from GitHub's answers, as pure functions.
 *
 * GitHub's own `reviewDecision` and check rollup exist only in GraphQL, which this install does
 * not call; these compute the same readings from the REST lists the sync already reads, and say
 * `null` or `unavailable` rather than guess when the answer is not there.
 */

export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required';
export type ChecksState = 'success' | 'failure' | 'pending';

interface ReviewLike {
  user?: { login: string } | null | undefined;
  state: string;
  submitted_at?: string | null | undefined;
}

/**
 * Where a pull request stands with its reviewers.
 *
 * Each human reviewer counts once, by their latest submitted word. A dismissed review is no
 * review, a pending one is unsubmitted, and a comment changes nothing. One open objection
 * outweighs any number of approvals, because that is what GitHub's branch protection enforces.
 */
export function reviewDecision(
  reviews: readonly ReviewLike[],
  author: string | null,
): ReviewDecision {
  const latest = new Map<string, { state: string; at: number }>();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!isHumanReviewer(login, author)) continue;
    if (review.submitted_at === null || review.submitted_at === undefined) continue;
    if (
      review.state !== 'APPROVED' &&
      review.state !== 'CHANGES_REQUESTED' &&
      review.state !== 'DISMISSED'
    ) {
      continue;
    }
    const at = Date.parse(review.submitted_at);
    const key = (login as string).toLowerCase();
    const known = latest.get(key);
    if (known === undefined || at >= known.at) latest.set(key, { state: review.state, at });
  }
  const states = [...latest.values()].map((entry) => entry.state);
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
  return states.includes('APPROVED') ? 'approved' : 'review_required';
}

interface CheckRunLike {
  status?: string | null | undefined;
  conclusion?: string | null | undefined;
}

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

/** Check runs rolled up to one reading. No checks is `null`: nothing was run, so nothing passed. */
export function checksRollup(runs: readonly CheckRunLike[]): ChecksState | null {
  if (runs.length === 0) return null;
  if (
    runs.some(
      (run) =>
        run.conclusion !== null && run.conclusion !== undefined && FAILED.has(run.conclusion),
    )
  ) {
    return 'failure';
  }
  return runs.some((run) => run.status !== 'completed') ? 'pending' : 'success';
}

export type Unavailable = 'forbidden' | 'not_found';
export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** The first page was not the whole list: these are at least this many. */
  truncated: boolean;
}
export type AlertSummary = SeverityCounts | { unavailable: Unavailable };

type AlertFeed = 'dependabot' | 'codeScanning' | 'secretScanning';

function severityOf(item: unknown, feed: AlertFeed): keyof Omit<SeverityCounts, 'truncated'> {
  const record = Object(item) as Record<string, unknown>;
  if (feed === 'secretScanning') return 'critical';
  if (feed === 'dependabot') {
    const advisory = Object(record['security_advisory']) as Record<string, unknown>;
    const level = advisory['severity'];
    return level === 'critical' || level === 'high' || level === 'low' ? level : 'medium';
  }
  const rule = Object(record['rule']) as Record<string, unknown>;
  const security = rule['security_severity_level'];
  if (
    security === 'critical' ||
    security === 'high' ||
    security === 'medium' ||
    security === 'low'
  ) {
    return security;
  }
  // Rules with no security level carry a plain severity; an alert with neither is not undercounted.
  if (rule['severity'] === 'error') return 'high';
  return rule['severity'] === 'note' ? 'low' : 'medium';
}

/** Open alerts by severity from one page of a feed, or `unavailable` when the token cannot read it. */
export function alertCounts(
  page: {
    items: readonly unknown[];
    nextPage: number | null;
    unavailable?: Unavailable | undefined;
  },
  feed: AlertFeed,
): AlertSummary {
  if (page.unavailable !== undefined) return { unavailable: page.unavailable };
  const counts: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    truncated: page.nextPage !== null,
  };
  for (const item of page.items) counts[severityOf(item, feed)] += 1;
  return counts;
}

export type ProtectionFacts =
  | { state: 'protected'; requiresReview: boolean; requiresChecks: boolean }
  | { state: 'unprotected' }
  | { state: 'unavailable' };

/**
 * The default branch's protection from `getBranchProtection`.
 *
 * GitHub answers an unprotected branch with 404 "Branch not protected", and answers a token
 * that may not read protection with a 403 or a bare 404. Only the first is a finding.
 */
export function protectionFacts(data: unknown): ProtectionFacts {
  const record = Object(data) as Record<string, unknown>;
  if (record['unavailable'] !== undefined) {
    return record['message'] === 'Branch not protected'
      ? { state: 'unprotected' }
      : { state: 'unavailable' };
  }
  return {
    state: 'protected',
    requiresReview: record['required_pull_request_reviews'] !== undefined,
    requiresChecks: record['required_status_checks'] !== undefined,
  };
}

export interface CommunityFacts {
  healthPercentage: number | null;
  license: boolean;
  codeOfConduct: boolean;
  contributing: boolean;
  issueTemplate: boolean;
  pullRequestTemplate: boolean;
  readme: boolean;
}

/** The community-profile files a health view grades, or `null` when GitHub did not return one. */
export function communityFacts(data: unknown): CommunityFacts | null {
  const record = Object(data) as Record<string, unknown>;
  if (record['files'] === undefined || record['unavailable'] !== undefined) return null;
  const files = Object(record['files']) as Record<string, unknown>;
  const has = (key: string) => files[key] !== null && files[key] !== undefined;
  const percentage = record['health_percentage'];
  return {
    healthPercentage: typeof percentage === 'number' ? percentage : null,
    license: has('license'),
    codeOfConduct: has('code_of_conduct'),
    contributing: has('contributing'),
    issueTemplate: has('issue_template'),
    pullRequestTemplate: has('pull_request_template'),
    readme: has('readme'),
  };
}
