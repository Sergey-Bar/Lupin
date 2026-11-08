import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsApiError } from '../lib/settings-client.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { health, read, settingsClient } from '../test-utils.js';
import { IdentitySettingsPage } from './IdentitySettings.js';
import { ToastProvider } from './Toasts.js';

afterEach(() => sessionStorage.clear());

const identityReads = vi.fn(async () => [
  read('identity.oidcIssuer'),
  read('identity.oidcClientId'),
  read('identity.oidcClientSecret', { secret: { set: false, last4: null } }),
  read('identity.oidcRoleMap'),
  read('identity.oidcDefaultRole', { source: 'default', value: 'viewer' }),
]);

function page(overrides: Parameters<typeof settingsClient>[0] = {}, search = '') {
  const go = vi.fn();
  const client = settingsClient({
    listSettings: identityReads,
    identityDraft: vi.fn(async () => ({
      id: 'd1',
      needsTest: true,
      testUrl: '/api/v1/auth/oidc/test?draft=d1',
      expiresAt: '2026-11-06T10:00:00.000Z',
    })),
    identityDraftStatus: vi.fn(async () => ({ id: 'd1', verified: null })),
    identityApply: vi.fn(async () => undefined),
    ...overrides,
  });
  const view = render(
    <ToastProvider>
      <IdentitySettingsPage health={health()} client={client} search={search} go={go} />
    </ToastProvider>,
  );
  return { client, go, ...view };
}

describe('Settings → Identity', () => {
  it('saves changes as a draft, then sends the person to test sign-in; Apply waits', async () => {
    const user = userEvent.setup();
    const { client, go, container } = page();
    expect(await screen.findByTestId('identity-no-draft')).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Role rules'), 'admin:alice@acme.test');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(client.identityDraft).toHaveBeenCalledWith({
        'identity.oidcRoleMap': 'admin:alice@acme.test',
      }),
    );
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Test sign-in' }));
    expect(go).toHaveBeenCalledWith('/api/v1/auth/oidc/test?draft=d1');
    expect(sessionStorage.getItem('lupin-identity-draft')).toBe('d1');
    await expectNoBlockingAxeViolations(container);
  });

  it('after a test sign-in as an admin, says so and applies the draft', async () => {
    sessionStorage.setItem('lupin-identity-draft', 'd1');
    const user = userEvent.setup();
    const { client } = page(
      {
        identityDraftStatus: vi.fn(async () => ({
          id: 'd1',
          verified: { email: 'alice@acme.test', groups: [], role: 'admin' as const },
        })),
      },
      '?test=done',
    );
    expect(await screen.findByTestId('identity-verdict')).toHaveTextContent(
      'You signed in as alice@acme.test, who would be admin. You keep admin access',
    );
    await user.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(client.identityApply).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText('Sign-in settings applied')).toBeInTheDocument();
    expect(sessionStorage.getItem('lupin-identity-draft')).toBeNull();
  });

  it('warns, and keeps Apply off, when the test came back as a viewer', async () => {
    sessionStorage.setItem('lupin-identity-draft', 'd1');
    page({
      identityDraftStatus: vi.fn(async () => ({
        id: 'd1',
        verified: { email: 'bob@acme.test', groups: ['eng'], role: 'viewer' as const },
      })),
    });
    expect(await screen.findByTestId('identity-verdict')).toHaveTextContent(
      '(groups: eng), who would be viewer. Applying this would remove your admin access.',
    );
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test again' })).toBeInTheDocument();
  });

  it('explains a sign-in that did not complete, and forgets an expired draft', async () => {
    sessionStorage.setItem('lupin-identity-draft', 'gone');
    page(
      { identityDraftStatus: vi.fn(async () => Promise.reject(new Error('404'))) },
      '?test=failed',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The provider did not complete the sign-in.',
    );
    await waitFor(() => expect(sessionStorage.getItem('lupin-identity-draft')).toBeNull());
  });

  it('applies a change that needs no test straight away, and reports a refusal with its fix', async () => {
    const user = userEvent.setup();
    const { client } = page({
      identityDraft: vi.fn(async () => ({
        id: 'd2',
        needsTest: false,
        testUrl: '',
        expiresAt: '',
      })),
      identityApply: vi.fn(async () => {
        throw new SettingsApiError(
          409,
          'Cloudflare Access rules cannot be tested.',
          'NOT_VERIFIED',
          'Sign in with the installation key.',
        );
      }),
    });
    await user.type(await screen.findByLabelText('Role rules'), 'admin:a@b.test');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await user.click(await screen.findByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(client.identityApply).toHaveBeenCalledWith('d2'));
    expect(
      await screen.findByText(
        'Cloudflare Access rules cannot be tested. Sign in with the installation key.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test sign-in' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(screen.getByTestId('identity-no-draft')).toBeInTheDocument();
  });

  it('asks a non-admin to find an admin', async () => {
    render(
      <ToastProvider>
        <IdentitySettingsPage
          health={health({ role: 'viewer' })}
          client={settingsClient()}
          search=""
          go={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Ask an admin to change sign-in settings.',
    );
  });
});
