import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { configure } from '@testing-library/dom';
import { MemoryRouter } from './router.js';

/**
 * The GitHub routes, reached **through the router**, for the same reason `qa-routes.test.tsx`
 * exists: the route wrapper is code (a path, a search parameter, a client), and no page test
 * enters it. Each case answers one GitHub endpoint and 404s the rest, so a wrapper that asked
 * for the wrong thing fails here instead of rendering the wrong data.
 */
configure({ asyncUtilTimeout: 15_000 });

beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const AT = '2026-10-23T09:00:00.000Z';

const REPO = {
  projectId: 'p1',
  name: 'Service',
  repository: 'octo/service',
  defaultBranch: 'main',
  syncEnabled: true,
  lastSyncedAt: AT,
  lastStatus: 'ok',
  lastError: null,
  openPullRequests: 1,
  openIssues: 1,
  stalePullRequests: 0,
  state: null,
  health: { score: 90, grade: 'A', findings: [] },
};

const PULL = {
  id: 'a',
  projectId: 'p1',
  projectName: 'Service',
  repository: 'octo/service',
  number: 1,
  title: 'Fix login',
  author: 'amy',
  state: 'open',
  draft: false,
  htmlUrl: null,
  headBranch: 'feature',
  baseBranch: 'main',
  labels: [],
  reviewDecision: 'approved',
  checksState: 'success',
  mergeableState: 'clean',
  requestedReviewers: [],
  openedAt: AT,
  lastActivityAt: AT,
  additions: 3,
  deletions: 1,
  headSha: 'abcdef1',
};

const ISSUE = {
  id: 'i',
  projectId: 'p1',
  projectName: 'Service',
  repository: 'octo/service',
  number: 7,
  title: 'Crash on save',
  author: 'bob',
  state: 'open',
  labels: [],
  assignees: [],
  commentCount: 0,
  htmlUrl: null,
  openedAt: AT,
  lastActivityAt: AT,
};

/** Answers the session and the GitHub reads, and records every URL asked for. */
function mockApi(): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith('/api/v1/auth/session')) return json({});
      if (url.endsWith('/api/v1/runs')) return json([]);
      if (url.includes('/api/v1/github/prs')) return json({ items: [PULL], nextCursor: null });
      if (url.includes('/api/v1/github/issues')) return json({ items: [ISSUE], nextCursor: null });
      if (url.endsWith('/api/v1/github/repos')) return json({ items: [REPO] });
      if (url.endsWith('/api/v1/github/repos/p1')) return json(REPO);
      if (url.endsWith('/api/v1/projects/p1/pull-requests/12/risk')) {
        return json({ pullRequest: 12, latest: null, history: [] });
      }
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }),
  );
  return asked;
}

describe('the GitHub routes are reachable', () => {
  it('opens the pull requests, already narrowed to the repository in the link', async () => {
    const asked = mockApi();
    render(<MemoryRouter initialEntries={['/dashboard/prs?project=p1']} />);
    expect(await screen.findByTestId('pull-detail')).toHaveTextContent('Fix login');
    // The search parameter reached the client, which is what proves the wrapper wired it.
    expect(asked.some((url) => url.includes('/github/prs') && url.includes('projectId=p1'))).toBe(
      true,
    );
  });

  it('opens the issues, narrowed the same way', async () => {
    const asked = mockApi();
    render(<MemoryRouter initialEntries={['/dashboard/issues?project=p1']} />);
    expect(await screen.findByTestId('issue-detail')).toHaveTextContent('Crash on save');
    expect(
      asked.some((url) => url.includes('/github/issues') && url.includes('projectId=p1')),
    ).toBe(true);
  });

  it('opens the repositories with the first one laid out', async () => {
    mockApi();
    render(<MemoryRouter initialEntries={['/dashboard/repos']} />);
    expect(await screen.findByTestId('repo-detail')).toHaveTextContent('Service');
  });

  it('opens one repository by the id in the path', async () => {
    const asked = mockApi();
    render(<MemoryRouter initialEntries={['/dashboard/repos/p1']} />);
    await waitFor(() => expect(screen.getByTestId('repo-score')).toHaveTextContent('Grade A'));
    expect(asked.some((url) => url.endsWith('/api/v1/github/repos/p1'))).toBe(true);
  });

  it('opens one pull request’s change risk by its project and number', async () => {
    const asked = mockApi();
    render(<MemoryRouter initialEntries={['/dashboard/prs/p1/12']} />);
    expect(await screen.findByText('Not assessed yet')).toBeInTheDocument();
    expect(asked.some((url) => url.endsWith('/api/v1/projects/p1/pull-requests/12/risk'))).toBe(
      true,
    );
  });

  it('says a path number that is not one is not a pull request, and asks for nothing', async () => {
    const asked = mockApi();
    render(<MemoryRouter initialEntries={['/dashboard/prs/p1/twelve']} />);
    expect(await screen.findByText(/That is not a pull request number/u)).toBeInTheDocument();
    expect(asked.some((url) => url.includes('/pull-requests/'))).toBe(false);
  });
});
