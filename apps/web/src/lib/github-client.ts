import {
  GithubActionsResponseSchema,
  GithubIssuePageSchema,
  GithubPullPageSchema,
  GithubRepoItemSchema,
  GithubRepoListSchema,
  PullRequestRiskHistorySchema,
  type GithubActionsBody,
  type GithubActionsResponse,
  type GithubIssueItem,
  type GithubPullItem,
  type GithubRepoItem,
  type PullRequestRiskHistory,
} from '@lupin/shared-contracts';
import { createJsonTransport, projectPath, queryString } from './json-transport.js';

/** The filters the inbox understands. Each one that is `undefined` is simply not sent. */
export interface InboxFilters {
  state?: 'open' | 'closed' | 'merged' | 'all' | undefined;
  projectId?: string | undefined;
  author?: string | undefined;
  label?: string | undefined;
  review?: 'approved' | 'changes_requested' | 'review_required' | undefined;
  checks?: 'success' | 'failure' | 'pending' | undefined;
  staleDays?: number | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** The GitHub command center: reads from the database the sync fills, writes through actions. */
export interface GithubClient {
  listPulls(filters: InboxFilters): Promise<Page<GithubPullItem>>;
  listIssues(filters: InboxFilters): Promise<Page<GithubIssueItem>>;
  listRepos(): Promise<{ items: GithubRepoItem[] }>;
  getRepo(projectId: string): Promise<GithubRepoItem>;
  /** Operator only. `dryRun` returns the plan and writes nothing. */
  runActions(body: GithubActionsBody): Promise<GithubActionsResponse>;
  /** A pull request's change risk: the latest assessment and its history across heads. */
  getPullRequestRisk(projectId: string, number: number): Promise<PullRequestRiskHistory>;
}

export function createGithubClient(baseUrl = '', fetchImpl: typeof fetch = fetch): GithubClient {
  const http = createJsonTransport(baseUrl, fetchImpl);
  return {
    listPulls: (filters) =>
      http.get(`/api/v1/github/prs${queryString({ ...filters })}`, GithubPullPageSchema),
    listIssues: (filters) =>
      http.get(`/api/v1/github/issues${queryString({ ...filters })}`, GithubIssuePageSchema),
    listRepos: () => http.get('/api/v1/github/repos', GithubRepoListSchema),
    getRepo: (projectId) =>
      http.get(`/api/v1/github/repos/${encodeURIComponent(projectId)}`, GithubRepoItemSchema),
    runActions: (body) => http.post('/api/v1/github/actions', body, GithubActionsResponseSchema),
    getPullRequestRisk: (projectId, number) =>
      http.get(
        `${projectPath(projectId)}/pull-requests/${String(number)}/risk`,
        PullRequestRiskHistorySchema,
      ),
  };
}
