import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GithubRepoItem } from '@lupin/shared-contracts';
import type { DeliveryClient } from '../lib/delivery-client.js';
import type { GithubClient } from '../lib/github-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { RepoDetailPage, ReposPage } from './GithubRepos.js';
import { ToastProvider } from './Toasts.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');

function repo(overrides: Partial<GithubRepoItem> = {}): GithubRepoItem {
  return {
    projectId: 'p1',
    name: 'Service',
    repository: 'octo/service',
    defaultBranch: 'main',
    syncEnabled: true,
    lastSyncedAt: '2026-10-23T11:00:00.000Z',
    lastStatus: 'ok',
    lastError: null,
    openPullRequests: 4,
    openIssues: 9,
    stalePullRequests: 1,
    state: null,
    health: { score: 95, grade: 'A', findings: [] },
    ...overrides,
  };
}

const UNPROTECTED = {
  id: 'no-branch-protection',
  severity: 'high',
  title: 'The default branch is not protected',
  evidence: 'Anyone with write access can push to it directly, or force-push over it.',
  fix: 'protect-branch',
  params: {},
} as const;

function pages(items: GithubRepoItem[], role: 'viewer' | 'operator' = 'viewer') {
  const setSource = vi.fn(async () => ({}));
  const sync = vi.fn(async () => ({ syncId: 's', duplicate: false }));
  return {
    github: {
      listRepos: vi.fn(async () => ({ items })),
      getRepo: vi.fn(async () => items[0] as GithubRepoItem),
    } as unknown as GithubClient,
    delivery: { setSource, sync } as unknown as DeliveryClient,
    health: {
      whoami: vi.fn(async () => ({ role, actor: 'x', mode: 'enforced' })),
    } as unknown as HealthClient,
    setSource,
    sync,
  };
}

const renderList = (p: ReturnType<typeof pages>) =>
  render(
    <ToastProvider>
      <ReposPage github={p.github} delivery={p.delivery} health={p.health} now={() => NOW} />
    </ToastProvider>,
  );

describe('ReposPage', () => {
  it('grades each repository, counts the ones with a serious finding, and never grades an unread one', async () => {
    const p = pages([
      repo({ name: 'Healthy' }),
      repo({
        projectId: 'p2',
        name: 'Risky',
        health: { score: 70, grade: 'C', findings: [UNPROTECTED] },
      }),
      repo({
        projectId: 'p3',
        name: 'Unread',
        syncEnabled: false,
        lastSyncedAt: null,
        lastStatus: null,
        health: { score: null, grade: null, findings: [] },
      }),
    ]);
    renderList(p);
    await screen.findByTestId('repo-detail');
    const rows = screen.getAllByTestId('repo-row');
    // Worst first: the one with a serious finding, then the healthy one, then the unread one.
    expect(within(rows[0] as HTMLElement).getByText(/Grade C/u)).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(UNPROTECTED.title)).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText(/Grade A/u)).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Not graded')).toBeInTheDocument();
    expect(screen.getByText('1 needs attention')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 repositories' })).toBeInTheDocument();

    // The selected repository is laid out beside the list; selecting another changes it.
    await userEvent.click((rows[1] as HTMLElement).closest('button')!);
    const detail = screen.getByTestId('repo-detail');
    expect(detail).toHaveTextContent('Healthy');
    expect(detail).toHaveTextContent(/Stale pull requests\s*1/u);
    expect(within(detail).getByText('Synced 1 hour ago')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
      'href',
      '/dashboard/prs?project=p1',
    );
  });

  it('offers to turn on sync to an operator only, then enables and queues the first read', async () => {
    const unread = repo({ syncEnabled: false, lastSyncedAt: null, lastStatus: null });
    const viewer = pages([unread], 'viewer');
    const { unmount } = renderList(viewer);
    await screen.findByText('Not syncing');
    expect(screen.queryByRole('button', { name: /Turn on sync/u })).not.toBeInTheDocument();
    unmount();

    const operator = pages([unread], 'operator');
    renderList(operator);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on sync for Service' }));
    await vi.waitFor(() => expect(operator.sync).toHaveBeenCalledWith('p1'));
    expect(operator.setSource).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ enabled: true, cadence: 'daily' }),
    );
    expect(await screen.findByText('Sync is on for Service')).toBeInTheDocument();
  });

  it('reports a sync that could not be turned on, and links each repository to its details', async () => {
    const operator = pages([repo({ syncEnabled: false, lastSyncedAt: null })], 'operator');
    operator.setSource.mockRejectedValueOnce(new Error('token missing'));
    renderList(operator);
    await userEvent.click(await screen.findByRole('button', { name: /Turn on sync/u }));
    expect(await screen.findByText('Could not turn on sync')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Details for Service' })).toHaveAttribute(
      'href',
      '/dashboard/repos/p1',
    );
  });

  it('keeps an Arabic repository name in its own direction and the repository path left to right', async () => {
    renderList(pages([repo({ name: 'خدمة الدفع', repository: 'octo/payments' })]));
    await screen.findByTestId('repo-detail');
    for (const element of screen.getAllByText('خدمة الدفع'))
      expect(element).toHaveAttribute('dir', 'auto');
    for (const element of screen.getAllByText('octo/payments'))
      expect(element).toHaveAttribute('dir', 'ltr');
  });

  it('says so when there are none and when the load fails', async () => {
    renderList(pages([]));
    expect(await screen.findByText(/No repositories yet/u)).toBeInTheDocument();
  });
});

describe('RepoDetailPage', () => {
  it('shows the score, every finding worst first with its evidence, and the open work', async () => {
    const p = pages([
      repo({
        health: {
          score: 83,
          grade: 'B',
          findings: [
            UNPROTECTED,
            {
              id: 'stale-pull-requests',
              severity: 'low',
              title: 'Stale pull requests',
              evidence: '1 open pull request untouched for 14 days or more.',
              fix: null,
              params: { count: 1, days: 14 },
            },
          ],
        },
        state: {
          community: null,
          protection: { state: 'unprotected' },
          alerts: {
            dependabot: { critical: 0, high: 0, medium: 0, low: 0, truncated: false },
            codeScanning: { unavailable: 'forbidden' },
            secretScanning: { critical: 0, high: 0, medium: 0, low: 0, truncated: false },
          },
          rateLimit: { limit: 5000, remaining: 4900, resetAt: '2026-10-23T13:00:00.000Z' },
          syncedAt: '2026-10-23T11:00:00.000Z',
        },
      }),
    ]);
    render(<RepoDetailPage projectId="p1" github={p.github} now={() => NOW} />);

    const score = await screen.findByTestId('repo-score');
    expect(score).toHaveTextContent('83');
    expect(score).toHaveTextContent('Grade B');
    const findings = screen.getAllByTestId('finding');
    expect(findings).toHaveLength(2);
    expect(within(findings[0] as HTMLElement).getByText('High')).toBeInTheDocument();
    expect(
      within(findings[0] as HTMLElement).getByText(/Anyone with write access/u),
    ).toBeInTheDocument();
    expect(screen.getByText('4,900 of 5,000 left, resets in 1 hour')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
      'href',
      '/dashboard/prs?project=p1',
    );
  });

  it('does not grade a repository that has not been read, and says nothing was found when clean', async () => {
    const unread = pages([repo({ health: { score: null, grade: null, findings: [] } })]);
    const { unmount } = render(<RepoDetailPage projectId="p1" github={unread.github} />);
    expect(await screen.findByTestId('repo-score')).toHaveTextContent(
      'Not graded: this repository has not been read yet',
    );
    unmount();
    const clean = pages([repo()]);
    render(<RepoDetailPage projectId="p1" github={clean.github} />);
    expect(await screen.findByText('Nothing wrong was found.')).toBeInTheDocument();
  });

  it('reports a repository that cannot be loaded', async () => {
    const github = {
      getRepo: vi.fn(async () => {
        throw new Error('No project');
      }),
    } as unknown as GithubClient;
    render(<RepoDetailPage projectId="nope" github={github} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this: No project');
  });
});

describe('repository writes', () => {
  function writable(role: 'viewer' | 'operator', items: GithubRepoItem[]) {
    const runActions = vi.fn(async (body: { dryRun: boolean; actions: unknown[] }) => ({
      dryRun: body.dryRun,
      results: body.actions.map((_, index) => ({
        action: 'protectBranch',
        target: `octo/service@main#${String(index)}`,
        outcome: body.dryRun ? ('planned' as const) : ('ok' as const),
        message: 'Done.',
        retryAt: null,
      })),
    }));
    const p = pages(items, role);
    (p.github as unknown as { runActions: typeof runActions }).runActions = runActions;
    return { ...p, runActions };
  }

  const risky = (projectId: string, name: string) =>
    repo({
      projectId,
      name,
      repository: `octo/${name.toLowerCase()}`,
      health: { score: 83, grade: 'B', findings: [UNPROTECTED] },
    });

  it('offers an operator the one-click fix beside the finding, and sends the protection request', async () => {
    const p = writable('operator', [risky('p1', 'Service')]);
    render(
      <ToastProvider>
        <RepoDetailPage projectId="p1" github={p.github} health={p.health} now={() => NOW} />
      </ToastProvider>,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Protect the default branch' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/already has protection is left exactly as it is/u),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Protect default branch' }));
    await vi.waitFor(() => expect(p.runActions).toHaveBeenCalled());
    expect(p.runActions.mock.calls[0]?.[0].actions).toEqual([
      { action: 'protectBranch', projectId: 'p1' },
    ]);
  });

  it('shows a viewer neither the fix nor the release', async () => {
    const p = writable('viewer', [risky('p1', 'Service')]);
    render(<RepoDetailPage projectId="p1" github={p.github} health={p.health} now={() => NOW} />);
    await screen.findByTestId('finding');
    expect(
      screen.queryByRole('button', { name: 'Protect the default branch' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create release' })).not.toBeInTheDocument();
  });

  it('creates a release from a tag, and will not submit without one', async () => {
    const p = writable('operator', [repo()]);
    render(
      <ToastProvider>
        <RepoDetailPage projectId="p1" github={p.github} health={p.health} now={() => NOW} />
      </ToastProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Create release' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Create release' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tag' }), 'v1.2.0');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Type' }),
      'prerelease',
    );
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await vi.waitFor(() => expect(p.runActions).toHaveBeenCalled());
    expect(p.runActions.mock.calls[0]?.[0].actions[0]).toMatchObject({
      action: 'createRelease',
      tag: 'v1.2.0',
      prerelease: true,
      draft: false,
    });
  });

  it('protects several repositories only after a preview, and never offers a bulk release', async () => {
    const p = writable('operator', [risky('p1', 'Alpha'), risky('p2', 'Beta')]);
    renderList(p);
    await screen.findByTestId('repo-detail');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select all repositories' }));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Create release' })).not.toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Protect default branch' }));

    const dialog = await screen.findByRole('dialog');
    const apply = within(dialog).getByRole('button', { name: 'Apply to 2 items' });
    expect(apply).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    await vi.waitFor(() => expect(apply).toBeEnabled());
    expect(p.runActions.mock.calls[0]?.[0].dryRun).toBe(true);
    await userEvent.click(apply);
    await vi.waitFor(() => expect(p.runActions).toHaveBeenCalledTimes(2));
    expect(p.runActions.mock.calls[1]?.[0].actions).toEqual([
      { action: 'protectBranch', projectId: 'p1' },
      { action: 'protectBranch', projectId: 'p2' },
    ]);
  });
  it('selects one repository at a time, clears the selection, and opens an action from the pane', async () => {
    const p = writable('operator', [risky('p1', 'Alpha'), risky('p2', 'Beta')]);
    renderList(p);
    await screen.findByTestId('repo-detail');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
    expect(
      within(screen.getByRole('region', { name: 'Bulk actions' })).getByText('1 selected'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();

    // The pane carries the repository's own actions, and the dialog can be walked away from.
    await userEvent.click(screen.getByRole('button', { name: 'Actions for octo/alpha#0' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Protect default branch' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(p.runActions).not.toHaveBeenCalled();
  });
});
