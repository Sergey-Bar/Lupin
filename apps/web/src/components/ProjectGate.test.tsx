import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetViewerRoleCache } from '../hooks/useViewerRole.js';
import type { QaClient } from '../lib/qa-client.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { ProjectGate } from './ProjectGate.js';

afterEach(() => {
  vi.unstubAllGlobals();
  resetViewerRoleCache();
});

/** The role `useViewerRole` reads, through the `whoami` request it makes. */
function signedInAs(role: 'viewer' | 'operator' | 'admin'): void {
  resetViewerRoleCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ actor: 'x', role, mode: 'enforced' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

const empty = { listProjects: vi.fn(async () => []) } as unknown as QaClient;

function gate() {
  return render(
    <ProjectGate qa={empty} title="Overview">
      {() => <p>never</p>}
    </ProjectGate>,
  );
}

describe('the empty-registry screen', () => {
  it('offers an admin setup, and the shortcut to connect a repository directly', async () => {
    signedInAs('admin');
    const { container } = gate();
    expect(await screen.findByRole('link', { name: 'Start setup' })).toHaveAttribute(
      'href',
      '/dashboard/setup',
    );
    expect(screen.getByRole('link', { name: 'Just connect a repository' })).toHaveAttribute(
      'href',
      '/dashboard/settings/projects',
    );
    expect(screen.queryByText(/LUPIN_PROJECT_ROOT|POST \/api/u)).toBeNull();
    await expectNoBlockingAxeViolations(container);
  });

  it('sends an operator straight to connecting a repository', async () => {
    signedInAs('operator');
    gate();
    expect(await screen.findByRole('link', { name: 'Connect a repository' })).toHaveAttribute(
      'href',
      '/dashboard/settings/projects',
    );
  });

  it('tells a viewer who can connect one, with no button that would be refused', async () => {
    signedInAs('viewer');
    gate();
    expect(await screen.findByTestId('onboarding-ask')).toHaveTextContent(
      'Ask an operator or admin of this workspace to connect a repository.',
    );
    expect(screen.queryByTestId('onboarding-connect')).toBeNull();
  });
});
