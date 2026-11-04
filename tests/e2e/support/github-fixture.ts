/**
 * Pull requests and issues for the browser to read, without a GitHub installation.
 *
 * The GitHub screens read what the delivery sync stored, and a fresh database has no
 * installation to sync from, so a layout or visual check that wanted a populated list had
 * nothing to show: `/dashboard/prs` rendered its empty state at every size and passed the
 * no-scroll contract by being short. These are intercepted at the HTTP boundary and shaped by
 * the shipped contract (`GithubPullPageSchema`, `GithubIssuePageSchema`), so the page parses
 * them with the same schema it parses the real API with.
 *
 * Fourteen pull requests is deliberate: more than fits the shortest viewport's list, so the
 * paging and the fit-to-height measurement are exercised rather than skipped.
 */
import type { Page } from '@playwright/test';

const HOUR = 3_600_000;

/** An ISO instant `hoursAgo` before a fixed reference, so the fixture does not drift per run. */
function instant(hoursAgo: number): string {
  return new Date(Date.UTC(2026, 10, 2, 12, 0, 0) - hoursAgo * HOUR).toISOString();
}

const AUTHORS = ['sergey-bar', 'dependabot[bot]', 'mira-k', 'o.haddad', 'renovate[bot]'] as const;

const TITLES = [
  'feat: GitHub command center (PR and issue inbox, repository health, write actions)',
  'chore(deps): bump the npm-minor-and-patch group with 8 updates',
  'fix(api): refuse a non-loopback bind with open access control',
  'chore(deps): bump croner from 10.0.1 to 11.0.0',
  'perf(web): page lists to the height the shell gives them',
  'docs: record the migration rehearsal against two PostgreSQL 16.4 instances',
  'refactor(runner): split process control from lease handling',
  'chore(deps): bump the docker-minor-and-patch group across 2 directories',
  'test(web): cover the empty and partial states of every route',
  'fix(worker): requeue a lost lease with RUNNER_LOST exactly once',
  'feat(reporting): flake cost and eval regression scorecards',
  'ci: install skillspector in the security job',
  'fix(ui): keep the menu inside the viewport near the bottom edge',
  'chore: tighten the k6 thresholds to the recorded run',
] as const;

const CHECKS = ['failure', 'success', 'pending', 'success', null] as const;
const REVIEWS = ['review_required', 'approved', 'changes_requested', null] as const;

export const FIXTURE_PULLS = TITLES.map((title, index) => ({
  id: `pull-${String(index)}`,
  projectId: '22222222-2222-4222-8222-222222222222',
  projectName: 'Lupin',
  repository: 'sergey-bar/lupin',
  number: 140 - index,
  title,
  author: AUTHORS[index % AUTHORS.length] ?? null,
  state: 'open' as const,
  draft: index % 7 === 6,
  htmlUrl: `https://github.com/sergey-bar/lupin/pull/${String(140 - index)}`,
  headBranch: `feat/branch-${String(index)}`,
  baseBranch: 'main',
  labels: index % 3 === 0 ? ['dependencies', 'automerge'] : [],
  reviewDecision: REVIEWS[index % REVIEWS.length] ?? null,
  checksState: CHECKS[index % CHECKS.length] ?? null,
  mergeableState: index % 4 === 0 ? 'blocked' : 'clean',
  requestedReviewers: index % 2 === 0 ? ['mira-k'] : [],
  openedAt: instant(2 + index * 5),
  lastActivityAt: instant(1 + index * 3),
  additions: 40 + index * 310,
  deletions: 12 + index * 47,
  headSha: `a1b2c3d4e5f6${String(index).padStart(2, '0')}`,
}));

export const FIXTURE_ISSUES = TITLES.map((title, index) => ({
  id: `issue-${String(index)}`,
  projectId: '22222222-2222-4222-8222-222222222222',
  projectName: 'Lupin',
  repository: 'sergey-bar/lupin',
  number: 90 - index,
  title: title.replace(/^[a-z]+: /u, '').replace(/^[a-z]+\([^)]*\): /u, ''),
  author: AUTHORS[(index + 2) % AUTHORS.length] ?? null,
  state: 'open' as const,
  labels: index % 2 === 0 ? ['bug'] : ['enhancement', 'good first issue'],
  assignees: index % 3 === 0 ? ['mira-k'] : [],
  commentCount: index % 5,
  htmlUrl: `https://github.com/sergey-bar/lupin/issues/${String(90 - index)}`,
  openedAt: instant(6 + index * 7),
  lastActivityAt: instant(2 + index * 4),
}));

/**
 * Answer the inbox reads with the fixtures above. Every other `/api/v1/github` call passes
 * through, so the repository list and any write still reach the real API.
 */
export async function mockGithubInbox(page: Page): Promise<void> {
  await page.route('**/api/v1/github/prs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: FIXTURE_PULLS, nextCursor: null }),
    }),
  );
  await page.route('**/api/v1/github/issues**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: FIXTURE_ISSUES, nextCursor: null }),
    }),
  );
}
