import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { QaClient } from '../lib/qa-client.js';
import type { RegisteredProject } from '../lib/qa.js';
import { SettingsApiError } from '../lib/settings-client.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { ConnectRepository } from './ConnectRepository.js';
import { ProjectsSettingsPage, QualityGatesSettingsPage, describeGate } from './SettingsPages.js';
import { health, settingsClient } from '../test-utils.js';
import { ToastProvider } from './Toasts.js';
import { confirmAction } from '../test-confirm.js';

const SHOP: RegisteredProject = {
  id: 'p1',
  workspaceId: 'ws-1',
  name: 'Shop',
  slug: 'shop',
  repoPath: '/src/shop',
  detectorVersion: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const qa = (projects: RegisteredProject[] = [SHOP]) =>
  ({ listProjects: vi.fn(async () => projects) }) as unknown as QaClient;

const registered = {
  project: { id: 'p2', name: 'shop' },
  commands: [
    { id: 'node.test', label: 'npm test' },
    { id: 'node.lint', label: 'npm run lint' },
  ],
};

describe('ConnectRepository', () => {
  it('connects a folder in one field, naming the project from its path, and reports what it found', async () => {
    const user = userEvent.setup();
    const client = settingsClient({ registerProject: vi.fn(async () => registered) });
    const onConnected = vi.fn();
    render(<ConnectRepository client={client} onConnected={onConnected} />);
    await user.type(screen.getByLabelText('Folder path'), '/home/me/code/shop');
    expect(screen.getByText('Leave empty to use “shop”.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect repository' }));
    expect(client.registerProject).toHaveBeenCalledWith({
      name: 'shop',
      slug: 'shop',
      repoPath: '/home/me/code/shop',
    });
    expect(await screen.findByTestId('repository-connected')).toHaveTextContent(
      'Found 2 commands Lupin can run: npm test, npm run lint.',
    );
    expect(onConnected).toHaveBeenCalledWith(registered);
    await user.click(screen.getByRole('button', { name: 'Connect another' }));
    expect(screen.getByLabelText('Folder path')).toBeInTheDocument();
  });

  it('connects a private git repository with its branch and token', async () => {
    const user = userEvent.setup();
    const client = settingsClient({
      registerProject: vi.fn(async () => ({ ...registered, commands: [] })),
    });
    render(<ConnectRepository client={client} onConnected={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'A git repository' }));
    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/acme/My Shop.git');
    await user.type(screen.getByLabelText('Default branch (optional)'), 'trunk');
    await user.type(screen.getByLabelText('Access token (private repositories only)'), 'tok');
    await user.type(screen.getByLabelText('Project name'), 'My Shop');
    await user.click(screen.getByRole('button', { name: 'Connect repository' }));
    expect(client.registerProject).toHaveBeenCalledWith({
      name: 'My Shop',
      slug: 'my-shop',
      gitUrl: 'https://github.com/acme/My Shop.git',
      defaultBranch: 'trunk',
      token: 'tok',
    });
    expect(await screen.findByTestId('repository-connected')).toHaveTextContent(
      'No test commands were detected yet.',
    );
  });

  it('says what is missing before sending anything, and shows the server’s fix when it refuses', async () => {
    const user = userEvent.setup();
    const client = settingsClient({
      registerProject: vi.fn(async () => {
        throw new SettingsApiError(
          409,
          'A project with this slug exists.',
          'CONFLICT',
          'Choose another name.',
        );
      }),
    });
    render(<ConnectRepository client={client} onConnected={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Connect repository' }));
    expect(screen.getByTestId('connect-error')).toHaveTextContent('Enter the folder path.');
    await user.click(screen.getByRole('button', { name: 'A git repository' }));
    await user.click(screen.getByRole('button', { name: 'Connect repository' }));
    expect(screen.getByTestId('connect-error')).toHaveTextContent('Enter the repository URL.');
    await user.type(screen.getByLabelText('Repository URL'), '/');
    await user.click(screen.getByRole('button', { name: 'Connect repository' }));
    expect(screen.getByTestId('connect-error')).toHaveTextContent('Give the project a name.');
    await user.type(screen.getByLabelText('Project name'), 'Shop');
    await user.click(screen.getByRole('button', { name: 'Connect repository' }));
    expect(
      await screen.findByText('A project with this slug exists. Choose another name.'),
    ).toBeInTheDocument();
    expect(client.registerProject).toHaveBeenCalledTimes(1);
  });
});

function projectsPage(
  overrides: Parameters<typeof settingsClient>[0] = {},
  role: 'viewer' | 'operator' | 'admin' = 'admin',
) {
  const client = settingsClient({
    updateProject: vi.fn(async () => undefined),
    deleteProject: vi.fn(async () => undefined),
    detectProject: vi.fn(async () => 3),
    gitTokenState: vi.fn(async () => true),
    putGitToken: vi.fn(async () => undefined),
    deleteGitToken: vi.fn(async () => undefined),
    ...overrides,
  });
  const view = render(
    <ToastProvider>
      <ProjectsSettingsPage health={health({ role })} client={client} qa={qa()} />
    </ToastProvider>,
  );
  return { client, ...view };
}

describe('Settings → Projects', () => {
  it('lists each project with its source, its token state and the actions an admin has', async () => {
    const { container } = projectsPage();
    const row = await screen.findByTestId('project-p1');
    expect(within(row).getByText('/src/shop')).toBeInTheDocument();
    expect(await within(row).findByText('Token saved')).toBeInTheDocument();
    for (const name of ['Rename', 'Re-scan', 'Access token', 'Delete']) {
      expect(within(row).getByRole('button', { name })).toBeInTheDocument();
    }
    await expectNoBlockingAxeViolations(container);
  });

  it('renames, re-scans and replaces the token', async () => {
    const user = userEvent.setup();
    const { client } = projectsPage();
    const row = await screen.findByTestId('project-p1');
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    const name = within(row).getByLabelText('New name');
    await user.clear(name);
    await user.type(name, 'Store');
    await user.click(within(row).getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(client.updateProject).toHaveBeenCalledWith('p1', { name: 'Store' }));
    await user.click(within(row).getByRole('button', { name: 'Re-scan' }));
    expect(await screen.findByText('Found 3 commands')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Access token' }));
    await user.type(within(row).getByLabelText('Replace the access token'), 'new-token');
    await user.click(within(row).getByRole('button', { name: 'Save token' }));
    await waitFor(() => expect(client.putGitToken).toHaveBeenCalledWith('p1', 'new-token'));
    await user.click(within(row).getByRole('button', { name: 'Access token' }));
    await confirmAction(user, row, 'Remove token');
    await waitFor(() => expect(client.deleteGitToken).toHaveBeenCalledWith('p1'));
  });

  it('deletes only once the project’s name is typed back', async () => {
    const user = userEvent.setup();
    const { client } = projectsPage();
    const row = await screen.findByTestId('project-p1');
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(within(row).getByText(/It cannot be undone/u)).toBeInTheDocument();
    const confirm = within(row).getByRole('button', { name: 'Delete project' });
    expect(confirm).toBeDisabled();
    await user.type(within(row).getByLabelText('Type Shop to confirm'), 'Shop');
    await user.click(confirm);
    await waitFor(() => expect(client.deleteProject).toHaveBeenCalledWith('p1', 'Shop'));
  });

  it('tells the person what failed and how to fix it', async () => {
    const user = userEvent.setup();
    projectsPage({
      detectProject: vi.fn(async () => {
        throw new SettingsApiError(
          400,
          'This project has no repository path.',
          'INVALID_REQUEST',
          null,
        );
      }),
    });
    const row = await screen.findByTestId('project-p1');
    await user.click(within(row).getByRole('button', { name: 'Re-scan' }));
    expect(await screen.findByText('This project has no repository path.')).toBeInTheDocument();
  });

  it('gives an operator rename and re-scan but not the token or delete, and a viewer neither', async () => {
    projectsPage({}, 'operator');
    const row = await screen.findByTestId('project-p1');
    expect(within(row).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('asks a viewer to find an admin rather than offering to connect', async () => {
    projectsPage({}, 'viewer');
    await screen.findByTestId('project-p1');
    expect(screen.getByTestId('ask-an-admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  });

  it('says plainly when nothing is connected yet', async () => {
    render(
      <ToastProvider>
        <ProjectsSettingsPage health={health()} client={settingsClient()} qa={qa([])} />
      </ToastProvider>,
    );
    expect(await screen.findByTestId('no-projects')).toHaveTextContent(
      'No repository is connected yet.',
    );
  });
});

describe('Settings → Quality gates', () => {
  const GATES = [
    { id: 'global', name: 'global', passRateThreshold: 90, createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 'g2', name: 'Release', passRateThreshold: 100, createdAt: '2026-11-01T00:00:00.000Z' },
  ];
  function gatesPage(role: 'viewer' | 'admin' = 'admin') {
    const client = settingsClient({
      listGates: vi.fn(async () => GATES),
      createGate: vi.fn(async (body: { name: string; passRateThreshold: number }) => ({
        ...GATES[1]!,
        id: 'g3',
        ...body,
      })),
      updateGate: vi.fn(async (id: string, body: { passRateThreshold?: number }) => ({
        ...GATES[0]!,
        id,
        ...body,
      })),
      deleteGate: vi.fn(async () => undefined),
    });
    const view = render(
      <ToastProvider>
        <QualityGatesSettingsPage health={health({ role })} client={client} />
      </ToastProvider>,
    );
    return { client, ...view };
  }

  it('states each rule in words, and never offers to remove the default gate', async () => {
    const { container } = gatesPage();
    const global = await screen.findByTestId('gate-global');
    expect(within(global).getByText('Default gate')).toBeInTheDocument();
    expect(
      within(global).getByText('A run passes when at least 90% of its tests pass.'),
    ).toBeInTheDocument();
    expect(within(global).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(
      within(screen.getByTestId('gate-g2')).getByText('A run passes only when every test passes.'),
    ).toBeInTheDocument();
    await expectNoBlockingAxeViolations(container);
  });

  it('changes a threshold, refusing one out of range, and removes and adds gates', async () => {
    const user = userEvent.setup();
    const { client } = gatesPage();
    const global = await screen.findByTestId('gate-global');
    const rate = within(global).getByLabelText('Minimum pass rate (%)');
    await user.clear(rate);
    await user.type(rate, '101');
    expect(within(global).getByText('Use a number from 0 to 100.')).toBeInTheDocument();
    expect(within(global).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(rate);
    await user.type(rate, '95');
    await user.click(within(global).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.updateGate).toHaveBeenCalledWith('global', { passRateThreshold: 95 }),
    );
    await confirmAction(user, screen.getByTestId('gate-g2'), 'Remove');
    await waitFor(() => expect(client.deleteGate).toHaveBeenCalledWith('g2'));
    const add = screen.getByRole('form', { name: 'Add a gate' });
    await user.type(within(add).getByLabelText('Name'), 'Nightly');
    await user.click(within(add).getByRole('button', { name: 'Add gate' }));
    await waitFor(() =>
      expect(client.createGate).toHaveBeenCalledWith({ name: 'Nightly', passRateThreshold: 90 }),
    );
  });

  it('shows a viewer the rules but no controls', async () => {
    gatesPage('viewer');
    await screen.findByTestId('gate-global');
    expect(screen.queryByRole('form', { name: 'Add a gate' })).toBeNull();
    expect(screen.queryByLabelText('Minimum pass rate (%)')).toBeNull();
  });

  it('offers a workspace admin only the gates the workspace owns, and says who changes the rest', async () => {
    render(
      <ToastProvider>
        <QualityGatesSettingsPage
          health={health({ role: 'admin', source: 'user', installationAdmin: false })}
          client={settingsClient({
            listGates: vi.fn(async () => [
              { ...GATES[0]!, scope: 'installation' as const },
              { ...GATES[1]!, id: 'own', scope: 'workspace' as const },
              // An older API sends no scope: treated as shared, so nothing is offered.
              { ...GATES[1]!, id: 'old' },
            ]),
          })}
        />
      </ToastProvider>,
    );
    const shared = await screen.findByTestId('gate-global');
    expect(within(shared).queryByLabelText('Minimum pass rate (%)')).toBeNull();
    expect(
      within(shared).getByText(
        'Every workspace shares this gate. An installation admin can change it.',
      ),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('gate-old')).queryByRole('button')).toBeNull();
    expect(
      within(screen.getByTestId('gate-own')).getByLabelText('Minimum pass rate (%)'),
    ).toBeInTheDocument();
    // Every gate the dashboard creates is shared, so the form is an installation admin's.
    expect(screen.queryByRole('form', { name: 'Add a gate' })).toBeNull();
  });

  it('describes the edge thresholds in words', () => {
    expect(describeGate({ passRateThreshold: 0 })).toBe('Every run passes, whatever its tests do.');
  });
});
