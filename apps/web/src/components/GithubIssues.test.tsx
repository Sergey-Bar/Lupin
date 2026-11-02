import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GithubIssueItem } from '@lupin/shared-contracts';
import type { GithubClient } from '../lib/github-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { ToastProvider } from './Toasts.js';
import { IssuesPage } from './GithubIssues.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');

function issue(overrides: Partial<GithubIssueItem> = {}): GithubIssueItem {
  return {
    id: 'a',
    projectId: 'p1',
    projectName: 'Service',
    repository: 'octo/service',
    number: 1,
    title: 'Crash on login',
    author: 'amy',
    state: 'open',
    labels: [],
    assignees: [],
    commentCount: 3,
    htmlUrl: 'https://github.com/octo/service/issues/1',
    openedAt: '2026-10-01T00:00:00.000Z',
    lastActivityAt: '2026-10-22T12:00:00.000Z',
    ...overrides,
  };
}

function client(items: GithubIssueItem[]) {
  const listIssues = vi.fn(async () => ({ items, nextCursor: null }));
  return {
    github: {
      listIssues,
      listRepos: vi.fn(async () => ({ items: [] })),
    } as unknown as GithubClient,
    listIssues,
  };
}

describe('IssuesPage', () => {
  it('counts the issues nobody has triaged and narrows to them on request', async () => {
    const { github } = client([
      issue({ id: 'u', title: 'No owner yet' }),
      issue({ id: 'l', number: 2, title: 'Labelled', labels: ['bug'] }),
      issue({ id: 'a', number: 3, title: 'Assigned', assignees: ['bob'] }),
    ]);
    render(<IssuesPage github={github} now={() => NOW} />);
    await screen.findByTestId('issue-detail');
    // The count sits on the filter that shows them.
    await userEvent.click(screen.getByRole('button', { name: 'No label or assignee 1' }));
    expect(screen.getAllByTestId('issue-row')).toHaveLength(1);
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'All' }),
    );
    expect(screen.getAllByTestId('issue-row')).toHaveLength(3);
  });

  it('shows who it is assigned to, comments, and a relative age', async () => {
    const { github } = client([issue({ assignees: ['bob'], commentCount: 7 })]);
    render(<IssuesPage github={github} now={() => NOW} />);
    const detail = await screen.findByTestId('issue-detail');
    expect(within(detail).getByText('bob')).toBeInTheDocument();
    expect(within(detail).getByText('7')).toBeInTheDocument();
    expect(within(detail).getByText(/active yesterday/u)).toBeInTheDocument();
    expect(
      within(detail).getByRole('link', { name: 'Open octo/service#1 on GitHub' }),
    ).toHaveAttribute('href', 'https://github.com/octo/service/issues/1');
    // The row keeps to the title, who and when.
    expect(within(screen.getByTestId('issue-row')).getByText('yesterday')).toBeInTheDocument();
  });

  it('says plainly when nobody owns an issue', async () => {
    const { github } = client([issue()]);
    render(<IssuesPage github={github} now={() => NOW} />);
    const detail = await screen.findByTestId('issue-detail');
    expect(detail).toHaveTextContent('Nobody owns this yet: it has no label and no assignee.');
    expect(within(detail).getByText('Unassigned')).toBeInTheDocument();
    expect(within(screen.getByTestId('issue-row')).getByText('Untriaged')).toBeInTheDocument();
  });

  it('gives Arabic and Hebrew issue text its own direction and keeps the number left to right', async () => {
    const { github } = client([
      issue({ id: 'ar', title: 'تعطل عند تسجيل الدخول', labels: ['خطأ'], assignees: ['سارة'] }),
      issue({ id: 'he', number: 2, title: 'קריסה בהתחברות' }),
    ]);
    render(<IssuesPage github={github} now={() => NOW} />);
    await screen.findByTestId('issue-detail');
    for (const element of screen.getAllByText('تعطل عند تسجيل الدخول'))
      expect(element).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('קריסה בהתחברות')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('خطأ')).toHaveAttribute('dir', 'auto');
    expect(screen.getAllByText('octo/service#1')[0]).toHaveAttribute('dir', 'ltr');
  });

  it('asks for closed issues when the state changes and says when a load fails', async () => {
    const { github, listIssues } = client([issue()]);
    render(<IssuesPage github={github} now={() => NOW} />);
    await screen.findByTestId('issue-detail');
    await userEvent.click(screen.getByRole('button', { name: 'Closed' }));
    await vi.waitFor(() =>
      expect(listIssues).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'closed' })),
    );

    const failing = {
      listIssues: vi.fn(async () => {
        throw new Error('nope');
      }),
      listRepos: vi.fn(async () => ({ items: [] })),
    } as unknown as GithubClient;
    render(<IssuesPage github={failing} now={() => NOW} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this: nope');
  });
});

describe('IssuesPage writes and paging', () => {
  function writable(
    role: 'viewer' | 'operator',
    pages?: Array<{ items: GithubIssueItem[]; nextCursor: string | null }>,
  ) {
    const runActions = vi.fn(async (body: { dryRun: boolean; actions: unknown[] }) => ({
      dryRun: body.dryRun,
      results: body.actions.map(() => ({
        action: 'close',
        target: 'octo/service#1',
        outcome: body.dryRun ? ('planned' as const) : ('ok' as const),
        message: 'Done.',
        retryAt: null,
      })),
    }));
    let call = 0;
    const sequence = pages ?? [
      {
        items: [
          issue({ id: 'a', number: 1, title: 'First' }),
          issue({ id: 'b', number: 2, title: 'Second' }),
        ],
        nextCursor: null,
      },
    ];
    const listIssues = vi.fn(async () => {
      const page = sequence[Math.min(call, sequence.length - 1)]!;
      call += 1;
      if (page.items.length === 0 && page.nextCursor === 'fail') throw new Error('later');
      return page;
    });
    const github = {
      listIssues,
      listRepos: vi.fn(async () => ({ items: [] })),
      runActions,
    } as unknown as GithubClient;
    const health = {
      whoami: vi.fn(async () => ({ role, actor: 'x', mode: 'enforced' })),
    } as unknown as HealthClient;
    render(
      <ToastProvider>
        <IssuesPage github={github} health={health} now={() => NOW} />
      </ToastProvider>,
    );
    return { runActions, listIssues };
  }

  it('shows a viewer no way to write', async () => {
    writable('viewer');
    await screen.findByTestId('issue-detail');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Actions for/u })).not.toBeInTheDocument();
  });

  it('lets an operator select one issue or all of them, and close the selection after a preview', async () => {
    const { runActions } = writable('operator');
    await screen.findByTestId('issue-detail');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select octo/service#2' }));
    expect(
      within(screen.getByRole('region', { name: 'Bulk actions' })).getByText('1 selected'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select octo/service#2' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all shown' }));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Close item' }));
    const dialog = await screen.findByRole('dialog');
    const apply = within(dialog).getByRole('button', { name: 'Apply to 2 items' });
    expect(apply).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);
    await waitFor(() => expect(runActions).toHaveBeenCalledTimes(2));
  });

  it('acts on the selected issue from its own menu', async () => {
    const { runActions } = writable('operator');
    await screen.findByTestId('issue-detail');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Actions for octo/service#1' }),
      'close',
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close item' }));
    await waitFor(() => expect(runActions).toHaveBeenCalled());
  });

  it('loads more, and keeps the list when loading more fails', async () => {
    writable('viewer', [
      { items: [issue({ id: 'a', number: 1, title: 'First' })], nextCursor: 'c1' },
      { items: [], nextCursor: 'fail' },
    ]);
    await screen.findByTestId('issue-detail');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Could not load more: later')).toBeInTheDocument();
    expect(screen.getAllByTestId('issue-row')).toHaveLength(1);
  });

  it('marks a closed issue as closed and says so in its detail', async () => {
    const { github } = client([issue({ state: 'closed', labels: ['bug'] })]);
    render(<IssuesPage github={github} now={() => NOW} />);
    const detail = await screen.findByTestId('issue-detail');
    expect(detail).toHaveTextContent('This issue is closed.');
    expect(within(screen.getByTestId('issue-row')).getByText('Closed')).toBeInTheDocument();
  });

  it('says when an issue is labelled but nobody is assigned, and when it is both', async () => {
    const { github } = client([
      issue({ id: 'l', labels: ['bug'] }),
      issue({ id: 'b', number: 2, title: 'Owned', labels: ['bug'], assignees: ['bob'] }),
    ]);
    render(<IssuesPage github={github} now={() => NOW} />);
    expect(await screen.findByTestId('issue-detail')).toHaveTextContent(
      'Labelled, but nobody is assigned to it.',
    );
    await userEvent.click(screen.getByText('Owned').closest('button')!);
    expect(screen.getByTestId('issue-detail')).toHaveTextContent('Labelled and assigned.');
  });
  it('searches by title, clears a selection, and walks away from a dialog', async () => {
    const { runActions } = writable('operator');
    await screen.findByTestId('issue-detail');
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'Second');
    expect(screen.getAllByTestId('issue-row')).toHaveLength(1);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select octo/service#2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Actions for octo/service#2' }),
      'close',
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(runActions).not.toHaveBeenCalled();
  });

  it('says why there is nothing when no repository is being read', async () => {
    const { github } = client([]);
    render(<IssuesPage github={github} now={() => NOW} />);
    expect(
      await screen.findByText(/Issues appear once a repository is being read/u),
    ).toBeInTheDocument();
  });
});
