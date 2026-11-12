import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignIn } from './Access.js';
import { makeHealthDouble } from '../test-utils.js';

/** The sign-in screen offers single sign-on when the install has it (ADR-014, team). */
afterEach(() => window.history.replaceState(null, '', '/'));

describe('sign-in with single sign-on', () => {
  it('offers the provider when the install has OIDC, as a link the browser follows', async () => {
    const health = makeHealthDouble('viewer', {
      signInMethods: vi.fn(async () => ({ oidc: true })),
    });
    render(<SignIn health={health} onSignedIn={() => undefined} />);
    const link = await screen.findByRole('link', { name: 'Sign in with single sign-on' });
    expect(link).toHaveAttribute('href', '/api/v1/auth/oidc/start');
  });

  it('offers no link when the install has none', async () => {
    const signInMethods = vi.fn(async () => ({ oidc: false }));
    render(
      <SignIn
        health={makeHealthDouble('viewer', { signInMethods })}
        onSignedIn={() => undefined}
      />,
    );
    await waitFor(() => expect(signInMethods).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Sign in with single sign-on' })).toBeNull();
  });

  // A failed read hid single sign-on and said nothing (ledger MNT-187).
  it('says when it could not check for single sign-on, and checks again', async () => {
    const signInMethods = vi
      .fn<() => Promise<{ oidc: boolean }>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ oidc: true });
    render(
      <SignIn
        health={makeHealthDouble('viewer', { signInMethods })}
        onSignedIn={() => undefined}
      />,
    );
    expect(await screen.findByText(/single sign-on could not be checked/iu)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(
      await screen.findByRole('link', { name: 'Sign in with single sign-on' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/single sign-on could not be checked/iu)).toBeNull();
  });

  it('says why the provider’s sign-in was refused, in words', async () => {
    window.history.replaceState(null, '', '/?signin=not-invited');
    render(
      <SignIn
        health={makeHealthDouble('viewer', { signInMethods: vi.fn(async () => ({ oidc: true })) })}
        onSignedIn={() => undefined}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You signed in, but nobody has given you access to this install yet.',
    );
  });
});
