import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CiPage, RepositoriesPage, ciSnippets, slugOf } from './Connections.js';
import { makeQa } from '../test-utils.js';
import type { HealthClient } from '../lib/health-client.js';
import type { RegisteredProject } from '../lib/qa.js';

const PROJECT: RegisteredProject = {
  id: 'p-1',
  workspaceId: 'w',
  name: 'checkout',
  slug: 'checkout',
  repoPath: '/srv/checkout',
  detectorVersion: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function health(): HealthClient {
  return { startScan: vi.fn(async () => ({ scanId: 's' })) } as unknown as HealthClient;
}

describe('slugOf', () => {
  it('takes the last path segment or repository name, in the slug alphabet', () => {
    expect(slugOf('C:\\code\\My App')).toBe('my-app');
    expect(slugOf('/srv/checkout/')).toBe('checkout');
    expect(slugOf('https://github.com/org/Repo.git')).toBe('repo');
    expect(slugOf('***')).toBe('project');
  });
});

describe('RepositoriesPage', () => {
  it('lists what is registered, with a scan button each', async () => {
    const qa = makeQa({ listProjects: vi.fn(async () => [PROJECT]) });
    const h = health();
    render(<RepositoriesPage qa={qa} health={h} />);
    const list = await screen.findByRole('list', { name: 'Registered repositories' });
    expect(list).toHaveTextContent('checkout');
    expect(list).toHaveTextContent('/srv/checkout');
    await userEvent.click(screen.getByRole('button', { name: 'Scan now' }));
    expect(h.startScan).toHaveBeenCalledWith('p-1');
  });

  it('adds a local folder, naming it from the path', async () => {
    const register = vi.fn(async () => PROJECT);
    const qa = makeQa({ listProjects: vi.fn(async () => []), registerProject: register });
    render(<RepositoriesPage qa={qa} health={health()} />);
    await userEvent.type(screen.getByLabelText('Folder path'), '/srv/checkout');
    await userEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    expect(register).toHaveBeenCalledWith({
      name: 'checkout',
      slug: 'checkout',
      repoPath: '/srv/checkout',
    });
  });

  it('adds a Git URL with a branch and a token, and never sends a folder path with it', async () => {
    const register = vi.fn(async () => PROJECT);
    const qa = makeQa({ listProjects: vi.fn(async () => []), registerProject: register });
    render(<RepositoriesPage qa={qa} health={health()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Git URL' }));
    await userEvent.type(screen.getByLabelText('Repository URL'), 'https://github.com/org/shop');
    await userEvent.type(screen.getByLabelText('Default branch (optional)'), 'main');
    await userEvent.type(screen.getByLabelText('Access token (private repositories)'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    expect(register).toHaveBeenCalledWith({
      name: 'shop',
      slug: 'shop',
      gitUrl: 'https://github.com/org/shop',
      defaultBranch: 'main',
      token: 'secret',
    });
  });

  it('asks for a location rather than sending an empty one', async () => {
    const register = vi.fn(async () => PROJECT);
    const qa = makeQa({ listProjects: vi.fn(async () => []), registerProject: register });
    render(<RepositoriesPage qa={qa} health={health()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the folder path.');
    expect(register).not.toHaveBeenCalled();
  });

  it("shows the API's refusal, such as a viewer who may not add one", async () => {
    const qa = makeQa({
      listProjects: vi.fn(async () => []),
      registerProject: vi.fn(async () => {
        throw new Error('API answered 403');
      }),
    });
    render(<RepositoriesPage qa={qa} health={health()} />);
    await userEvent.type(screen.getByLabelText('Folder path'), '/srv/x');
    await userEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('403'));
  });
});

describe('CiPage', () => {
  it('shows each pipeline command for this install, with a copy button', () => {
    render(<CiPage origin="https://lupin.local" />);
    for (const snippet of ciSnippets('https://lupin.local')) {
      expect(screen.getByRole('button', { name: `Copy ${snippet.title}` })).toBeDefined();
    }
    expect(screen.getByTestId('connections-ci')).toHaveTextContent('LUPIN_URL=https://lupin.local');
  });
});
