import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GithubPullItem, GithubRepoItem } from '@lupin/shared-contracts';
import type { GithubClient } from '../lib/github-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { PullRequestsPage } from './GithubPulls.js';
import { ToastProvider } from './Toasts.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');

function pull(overrides: Partial<GithubPullItem> = {}): GithubPullItem {
  return {
    id: 'a',
    projectId: 'p1',
    projectName: 'Service',
    repository: 'octo/service',
    number: 1,
    title: 'Change',
    author: 'amy',
    state: 'open',
    draft: false,
    htmlUrl: 'https://github.com/octo/service/pull/1',
    headBranch: 'feature/login',
    baseBranch: 'main',
    labels: [],
    reviewDecision: 'review_required',
    checksState: 'success',
    mergeableState: 'clean',
    requestedReviewers: [],
    openedAt: '2026-10-20T00:00:00.000Z',
    lastActivityAt: '2026-10-23T09:00:00.000Z',
    additions: 10,
    deletions: 2,
    headSha: 'abcdef1',
    ...overrides,
  };
}

function repo(overrides: Partial<GithubRepoItem> = {}): GithubRepoItem {
  return {
    projectId: 'p1',
    name: 'Service',
    repository: 'octo/service',
    defaultBranch: 'main',
    syncEnabled: true,
    lastSyncedAt: null,
    lastStatus: null,
    lastError: null,
    openPullRequests: 0,
    openIssues: 0,
    stalePullRequests: 0,
    state: null,
    health: { score: null, grade: null, findings: [] },
    ...overrides,
  };
}

function client(pages: Array<{ items: GithubPullItem[]; nextCursor: string | null }>) {
  let call = 0;
  const listPulls = vi.fn(async () => pages[Math.min(call++, pages.length - 1)]!);
  const github = {
    listPulls,
    listRepos: vi.fn(async () => ({ items: [repo()] })),
  } as unknown as GithubClient;
  return { github, listPulls };
}

describe('PullRequestsPage writes', () => {
  const operatorHealth = (role: 'viewer' | 'operator') =>
    ({
      whoami: vi.fn(async () => ({ role, actor: 'x', mode: 'enforced' })),
    }) as unknown as HealthClient;

  function writable(role: 'viewer' | 'operator') {
    const runActions = vi.fn(async (body: { dryRun: boolean; actions: unknown[] }) => ({
      dryRun: body.dryRun,
      results: body.actions.map((_, index) => ({
        action: 'x',
        target: `octo/service#${String(index + 1)}`,
        outcome: body.dryRun ? ('planned' as const) : ('ok' as const),
        message: 'Done.',
        retryAt: null,
      })),
    }));
    const listPulls = vi.fn(async () => ({
      items: [
        pull({ id: 'a', number: 1, title: 'First', reviewDecision: 'approved' }),
        pull({ id: 'b', number: 2, title: 'Second' }),
      ],
      nextCursor: null,
    }));
    const github = {
      listPulls,
      listRepos: vi.fn(async () => ({ items: [repo()] })),
      runActions,
    } as unknown as GithubClient;
    render(
      <ToastProvider>
        <PullRequestsPage github={github} health={operatorHealth(role)} now={() => NOW} />
      </ToastProvider>,
    );
    return { runActions, listPulls };
  }

  it('shows a viewer no way to write', async () => {
    writable('viewer');
    await screen.findByText('First');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Actions for/u })).not.toBeInTheDocument();
  });

  it('lets an operator act on one pull request from its row, and reloads the list afterwards', async () => {
    const { runActions, listPulls } = writable('operator');
    await screen.findByText('First');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Actions for octo/service#1' }),
      'merge',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(runActions).toHaveBeenCalled());
    expect(runActions.mock.calls[0]?.[0].actions[0]).toMatchObject({
      action: 'merge',
      number: 1,
      sha: 'abcdef1',
    });
    // The list is read again, so the merged pull request leaves the open queue.
    await waitFor(() => expect(listPulls.mock.calls.length).toBeGreaterThan(1));
  });

  it('offers only the actions that fit what is selected, never a merge, and acts on what is shown', async () => {
    const { runActions } = writable('operator');
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all shown' }));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument();

    // Narrow the list: the hidden item is no longer part of the selection that will be acted on.
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'First');
    expect(
      within(screen.getByRole('region', { name: 'Bulk actions' })).getByText('1 selected'),
    ).toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', {
        name: 'Close item',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close item' }));
    await waitFor(() => expect(runActions).toHaveBeenCalled());
    expect(runActions.mock.calls[0]?.[0].actions).toHaveLength(1);
  });
});

describe('PullRequestsPage', () => {
  it('ranks what can be merged first and says how many there are', async () => {
    const { github } = client([
      {
        items: [
          pull({ id: 'w', title: 'Waiting one' }),
          pull({ id: 'r', title: 'Ready one', reviewDecision: 'approved' }),
          pull({ id: 'b', title: 'Blocked one', checksState: 'failure' }),
        ],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);

    await screen.findByText('Ready one');
    const rows = screen.getAllByTestId('pull-row');
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
      'Ready one',
      'Blocked one',
      'Waiting one',
    ]);
    const status = screen.getByTestId('pulls-status');
    expect(status).toHaveTextContent('1');
    expect(status).toHaveTextContent('pull request ready to merge');
  });

  it('shows a verdict as a word as well as a colour, and relative age', async () => {
    const { github } = client([
      {
        items: [pull({ reviewDecision: 'changes_requested', checksState: 'failure' })],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);
    const row = await screen.findByTestId('pull-row');
    expect(within(row).getByText('Changes requested')).toBeInTheDocument();
    expect(within(row).getByText('Failing')).toBeInTheDocument();
    expect(within(row).getByText('3 hours ago')).toBeInTheDocument();
  });

  it('does not ask a finished pull request for a review or checks it will never get', async () => {
    const { github } = client([
      {
        items: [
          pull({
            id: 'm',
            title: 'Already merged',
            state: 'merged',
            reviewDecision: 'review_required',
            checksState: null,
          }),
          pull({
            id: 'a',
            number: 2,
            title: 'Merged and approved',
            state: 'merged',
            reviewDecision: 'approved',
            checksState: null,
          }),
        ],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);
    const rows = await screen.findAllByTestId('pull-row');
    const [merged, approved] = rows as [HTMLElement, HTMLElement];
    expect(within(merged).queryByText('Needs review')).not.toBeInTheDocument();
    expect(within(merged).queryByText('No checks')).not.toBeInTheDocument();
    // What actually happened is still worth showing.
    expect(within(approved).getByText('Approved')).toBeInTheDocument();
  });

  it('gives Arabic and Hebrew titles their own direction and keeps identifiers left to right', async () => {
    const { github } = client([
      {
        items: [
          pull({
            id: 'ar',
            title: 'إصلاح خطأ تسجيل الدخول',
            labels: ['خطأ'],
            author: 'سارة',
          }),
          pull({ id: 'he', number: 2, title: 'תיקון באג בהתחברות', headBranch: 'fix/התחברות' }),
        ],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);

    const arabic = await screen.findByText('إصلاح خطأ تسجيل الدخول');
    expect(arabic).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('תיקון באג בהתחברות')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('خطأ')).toHaveAttribute('dir', 'auto');
    // A repository, a number and a branch are identifiers: isolated and left to right.
    expect(screen.getAllByText('octo/service#1')[0]?.tagName).toBe('BDI');
    expect(screen.getAllByText('octo/service#1')[0]).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('fix/התחברות').tagName).toBe('BDI');
    expect(screen.getByText('fix/התחברות')).toHaveAttribute('dir', 'ltr');
  });

  it('finds a pull request by a word in an Arabic title', async () => {
    const { github } = client([
      {
        items: [
          pull({ id: 'ar', title: 'إصلاح خطأ تسجيل الدخول' }),
          pull({ id: 'en', number: 2, title: 'Other' }),
        ],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);
    await screen.findByText('Other');
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'تسجيل');
    expect(screen.getAllByTestId('pull-row')).toHaveLength(1);
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('filters by bucket, and the status line can jump to the ready ones', async () => {
    const { github } = client([
      {
        items: [
          pull({ id: 'r', title: 'Ready one', reviewDecision: 'approved' }),
          pull({ id: 'w', number: 2, title: 'Waiting one' }),
        ],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);
    await screen.findByText('Waiting one');
    await userEvent.click(screen.getByRole('button', { name: 'Show them' }));
    expect(screen.getAllByTestId('pull-row')).toHaveLength(1);
    expect(screen.getByText('Ready one')).toBeInTheDocument();
  });

  it('starts over when a filter changes, and pages forward on load more', async () => {
    const { github, listPulls } = client([
      { items: [pull({ id: 'one', title: 'First page' })], nextCursor: 'c1' },
      { items: [pull({ id: 'two', number: 2, title: 'Second page' })], nextCursor: null },
      {
        items: [pull({ id: 'three', number: 3, title: 'Merged one', state: 'merged' })],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);
    await screen.findByText('First page');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Second page');
    expect(screen.getByText('First page')).toBeInTheDocument();
    expect(listPulls).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));

    await userEvent.click(screen.getByRole('button', { name: 'Merged' }));
    await screen.findByText('Merged one');
    expect(screen.queryByText('First page')).not.toBeInTheDocument();
    expect(listPulls).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'merged', cursor: undefined }),
    );
  });

  it('says so when the load fails, and when no repository is being read', async () => {
    const failing = {
      listPulls: vi.fn(async () => {
        throw new Error('boom');
      }),
      listRepos: vi.fn(async () => ({ items: [repo()] })),
    } as unknown as GithubClient;
    const { unmount } = render(<PullRequestsPage github={failing} now={() => NOW} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this: boom');
    unmount();

    const { github } = client([{ items: [], nextCursor: null }]);
    (github.listRepos as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [repo({ syncEnabled: false })],
    });
    render(<PullRequestsPage github={github} now={() => NOW} />);
    await waitFor(() =>
      expect(
        screen.getByText(/Turn on the sync for a project under Repositories/u),
      ).toBeInTheDocument(),
    );
  });
});
