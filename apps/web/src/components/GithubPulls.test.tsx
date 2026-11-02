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

/** The row button for a title; the same words also head the detail, so a row is asked for by role. */
const rowOf = (title: string) =>
  screen.getAllByTestId('pull-row').find((row) => row.textContent?.includes(title))!;
const openRow = (title: string) => userEvent.click(rowOf(title).closest('button')!);

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
    await screen.findByTestId('pull-detail');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Actions for/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Merge octo/u })).not.toBeInTheDocument();
  });

  it('lets an operator act on the selected pull request, and reloads the list afterwards', async () => {
    const { runActions, listPulls } = writable('operator');
    await screen.findByTestId('pull-detail');
    // The approved one is selected first and carries its own merge button; the other does not.
    await openRow('Second');
    expect(screen.queryByRole('button', { name: 'Merge octo/service#2' })).not.toBeInTheDocument();
    await openRow('First');
    await userEvent.click(screen.getByRole('button', { name: 'Merge octo/service#1' }));
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
    await screen.findByTestId('pull-detail');
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

  it('selects one at a time, clears, walks away from a dialog, and narrows by repository', async () => {
    const { runActions, listPulls } = writable('operator');
    await screen.findByTestId('pull-detail');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select octo/service#2' }));
    expect(
      within(screen.getByRole('region', { name: 'Bulk actions' })).getByText('1 selected'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select octo/service#2' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select octo/service#1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Merge octo/service#1' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(runActions).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Repository' }), 'p1');
    await waitFor(() =>
      expect(listPulls).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p1' })),
    );
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

    await screen.findByTestId('pull-detail');
    const rows = screen.getAllByTestId('pull-row');
    expect(rows[0]).toHaveTextContent('Ready one');
    expect(rows[1]).toHaveTextContent('Blocked one');
    expect(rows[2]).toHaveTextContent('Waiting one');
    // The count sits on the filter that shows them, and the panel says how many are listed.
    expect(screen.getByRole('button', { name: 'Ready 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blocked 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 pull requests' })).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Ready to merge')).toBeInTheDocument();
    // The best one is already open beside the list.
    expect(screen.getByTestId('pull-detail')).toHaveTextContent('Ready one');
  });

  it('lays the selected pull request out in full: the gates, the branch, the people and the size', async () => {
    const { github } = client([
      {
        items: [
          pull({
            title: 'Fix login',
            reviewDecision: 'changes_requested',
            checksState: 'failure',
            mergeableState: 'dirty',
            requestedReviewers: ['bob'],
            labels: ['bug'],
            additions: 30,
            deletions: 10,
          }),
        ],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);
    const detail = await screen.findByTestId('pull-detail');
    const gates = within(detail).getByRole('group', { name: 'Merge readiness' });
    expect(within(gates).getByText('Changes requested')).toBeInTheDocument();
    expect(within(gates).getByText('Failing')).toBeInTheDocument();
    expect(within(gates).getByText('Conflicts with the base branch')).toBeInTheDocument();
    expect(detail).toHaveTextContent('Needs work before it can merge.');
    expect(within(detail).getByText('feature/login')).toBeInTheDocument();
    expect(within(detail).getByText('main')).toBeInTheDocument();
    expect(within(detail).getByText('bob')).toBeInTheDocument();
    expect(within(detail).getByText('bug')).toBeInTheDocument();
    expect(within(detail).getByText('+30')).toBeInTheDocument();
    expect(within(detail).getByText('−10')).toBeInTheDocument();
    expect(within(detail).getByText(/^3 days ago/u)).toBeInTheDocument();
    // A row stays short: its status and its age.
    const row = screen.getByTestId('pull-row');
    expect(within(row).getByText('Blocked')).toBeInTheDocument();
    expect(within(row).getByText('3 hours ago')).toBeInTheDocument();
  });

  it('follows the selection: another row, another detail', async () => {
    const { github } = client([
      {
        items: [pull({ id: 'a', title: 'One' }), pull({ id: 'b', number: 2, title: 'Two' })],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);
    await screen.findByTestId('pull-detail');
    expect(screen.getByTestId('pull-detail')).toHaveTextContent('One');
    await openRow('Two');
    expect(screen.getByTestId('pull-detail')).toHaveTextContent('Two');
    expect(rowOf('Two').closest('button')).toHaveAttribute('aria-current', 'true');
    // Focus alone selects, which is how j and k browse.
    const li = rowOf('One').closest('li')!;
    li.tabIndex = -1; // as the app's j / k walk does before it focuses a row
    li.focus();
    await waitFor(() => expect(screen.getByTestId('pull-detail')).toHaveTextContent('One'));
  });

  it('asks nothing of a finished pull request, and says what happened to it', async () => {
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
        ],
        nextCursor: null,
      },
    ]);
    render(<PullRequestsPage github={github} now={() => NOW} />);
    const detail = await screen.findByTestId('pull-detail');
    expect(detail).toHaveTextContent('This pull request was merged.');
    expect(
      within(detail).queryByRole('group', { name: 'Merge readiness' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting for a review')).not.toBeInTheDocument();
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

    await screen.findByTestId('pull-detail');
    for (const title of ['إصلاح خطأ تسجيل الدخول', 'תיקון באג בהתחברות']) {
      for (const element of screen.getAllByText(title))
        expect(element).toHaveAttribute('dir', 'auto');
    }
    expect(screen.getByText('خطأ')).toHaveAttribute('dir', 'auto');
    // A repository, a number and a branch are identifiers: isolated and left to right.
    expect(screen.getAllByText('octo/service#1')[0]?.tagName).toBe('BDI');
    expect(screen.getAllByText('octo/service#1')[0]).toHaveAttribute('dir', 'ltr');
    await openRow('תיקון באג בהתחברות');
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

  it('filters by bucket from the counted filter', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'Ready 1' }));
    expect(screen.getAllByTestId('pull-row')).toHaveLength(1);
    expect(screen.getAllByTestId('pull-row')[0]).toHaveTextContent('Ready one');
  });

  it('pages what does not fit, and says which rows are on the page', async () => {
    const many = Array.from({ length: 11 }, (_, index) =>
      pull({ id: `p${String(index)}`, number: index + 1, title: `Change ${String(index + 1)}` }),
    );
    const { github } = client([{ items: many, nextCursor: null }]);
    render(<PullRequestsPage github={github} now={() => NOW} />);
    await screen.findByTestId('pull-detail');
    expect(screen.getAllByTestId('pull-row')).toHaveLength(8);
    expect(screen.getByText('1–8 of 11')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next pull requests page' }));
    expect(screen.getAllByTestId('pull-row')).toHaveLength(3);
    expect(screen.getByText('9–11 of 11')).toBeInTheDocument();
  });

  it('offers to bring a branch that fell behind up to date, and only for open work', async () => {
    const { github } = client([
      {
        items: [
          pull({ id: 'b', number: 5, title: 'Behind', mergeableState: 'behind' }),
          pull({ id: 'm', number: 6, title: 'Gone', state: 'merged', mergeableState: 'behind' }),
        ],
        nextCursor: null,
      },
    ]);
    const health = {
      whoami: vi.fn(async () => ({ role: 'operator', actor: 'x', mode: 'enforced' })),
    } as unknown as HealthClient;
    render(
      <ToastProvider>
        <PullRequestsPage github={github} health={health} now={() => NOW} />
      </ToastProvider>,
    );
    await screen.findByTestId('pull-detail');
    expect(
      screen.getByRole('button', { name: 'Update branch octo/service#5' }),
    ).toBeInTheDocument();
    await openRow('Gone');
    expect(screen.queryByRole('button', { name: /Update branch/u })).not.toBeInTheDocument();
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
    await screen.findByTestId('pull-detail');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Second page');
    expect(rowOf('First page')).toBeInTheDocument();
    expect(listPulls).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));

    await userEvent.click(screen.getByRole('button', { name: 'Merged' }));
    await waitFor(() =>
      expect(screen.getAllByTestId('pull-row')[0]).toHaveTextContent('Merged one'),
    );
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
