import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseSignoff } from '@lupin/shared-contracts';
import { resetViewerRoleCache } from '../hooks/useViewerRole.js';
import { ReleaseSignoffPanel } from './ReleaseSignoff.js';
import { ToastProvider } from './Toasts.js';

/** Release sign-off on Home (plan Wave 1 task 5). */
function signedInAs(role: 'viewer' | 'operator') {
  resetViewerRoleCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ actor: 'you', role, mode: 'enforced' }))),
  );
}
afterEach(() => vi.unstubAllGlobals());

const signoff = (overrides: Partial<ReleaseSignoff> = {}): ReleaseSignoff => ({
  id: 's1',
  projectId: 'p',
  commit: 'abc1234def',
  decision: 'ship',
  verdict: 'no-go',
  override: true,
  reason: 'hotfix for checkout',
  actor: 'token:admin',
  createdAt: '2026-11-12T09:00:00.000Z',
  ...overrides,
});

function panel(list: ReleaseSignoff[], record = vi.fn(async () => signoff())) {
  render(
    <ToastProvider>
      <ReleaseSignoffPanel source={{ list: vi.fn(async () => list), record }} projectId="p" />
    </ToastProvider>,
  );
  return record;
}

describe('release sign-off', () => {
  it('shows the latest decision, and says plainly when it overrode the verdict', async () => {
    signedInAs('operator');
    panel([signoff()]);
    const latest = await screen.findByTestId('signoff-latest');
    expect(latest).toHaveTextContent('Ship');
    expect(latest).toHaveTextContent('Override');
    expect(latest).toHaveTextContent('against a No-go verdict: hotfix for checkout');
  });

  it('records a hold with the commit and reason, and needs both', async () => {
    signedInAs('operator');
    const user = userEvent.setup();
    const record = panel(
      [],
      vi.fn(async () => signoff({ decision: 'hold', override: false })),
    );
    const form = await screen.findByRole('form', { name: 'Sign off a release' });
    await waitFor(() => expect(within(form).getByLabelText('Commit')).toBeEnabled());
    const hold = within(form).getByRole('button', { name: 'Hold' });
    expect(hold).toBeDisabled();
    await user.type(within(form).getByLabelText('Commit'), 'abc1234');
    expect(hold).toBeDisabled();
    await user.type(within(form).getByLabelText('Reason (required)'), 'smoke is red');
    await user.click(hold);
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith('p', {
        commit: 'abc1234',
        decision: 'hold',
        reason: 'smoke is red',
      }),
    );
  });

  it('shows a viewer the record but not the controls', async () => {
    signedInAs('viewer');
    panel([]);
    expect(
      await screen.findByText('An operator or admin signs off a release.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Commit')).toBeDisabled();
  });
});
