import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GithubIssueItem } from '@lupin/shared-contracts';
import type { GithubClient } from '../lib/github-client.js';
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
      issue({ id: 'u', title: 'Untriaged' }),
      issue({ id: 'l', number: 2, title: 'Labelled', labels: ['bug'] }),
      issue({ id: 'a', number: 3, title: 'Assigned', assignees: ['bob'] }),
    ]);
    render(<IssuesPage github={github} now={() => NOW} />);
    await screen.findByText('Untriaged');
    expect(screen.getByTestId('issues-status')).toHaveTextContent('1');
    expect(screen.getByTestId('issues-status')).toHaveTextContent(
      'open issue has no label and no assignee',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Show them' }));
    expect(screen.getAllByTestId('issue-row')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Show all issues' }));
    expect(screen.getAllByTestId('issue-row')).toHaveLength(3);
  });

  it('shows who it is assigned to, comments, and a relative age', async () => {
    const { github } = client([issue({ assignees: ['bob'], commentCount: 7 })]);
    render(<IssuesPage github={github} now={() => NOW} />);
    const row = await screen.findByTestId('issue-row');
    expect(within(row).getByText('bob')).toBeInTheDocument();
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(within(row).getByText('yesterday')).toBeInTheDocument();
    expect(
      within(row).getByRole('link', { name: 'Open octo/service#1 on GitHub' }),
    ).toHaveAttribute('href', 'https://github.com/octo/service/issues/1');
  });

  it('gives Arabic and Hebrew issue text its own direction and keeps the number left to right', async () => {
    const { github } = client([
      issue({ id: 'ar', title: 'تعطل عند تسجيل الدخول', labels: ['خطأ'], assignees: ['سارة'] }),
      issue({ id: 'he', number: 2, title: 'קריסה בהתחברות' }),
    ]);
    render(<IssuesPage github={github} now={() => NOW} />);
    expect(await screen.findByText('تعطل عند تسجيل الدخول')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('קריסה בהתחברות')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('خطأ')).toHaveAttribute('dir', 'auto');
    expect(screen.getAllByText('octo/service#1')[0]).toHaveAttribute('dir', 'ltr');
  });

  it('asks for closed issues when the state changes and says when a load fails', async () => {
    const { github, listIssues } = client([issue()]);
    render(<IssuesPage github={github} now={() => NOW} />);
    await screen.findByText('Crash on login');
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
