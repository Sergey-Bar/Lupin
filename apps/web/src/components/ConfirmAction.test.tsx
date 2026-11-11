import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { ConfirmAction } from './ConfirmAction.js';

/**
 * A destructive action asks first (ledger MNT-185). Revoking a token, removing a member or
 * the GitHub App, and removing a channel, a schedule, a gate or a project token all took
 * effect on one click; project delete was the only one that asked.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

describe('ConfirmAction', () => {
  it('does nothing on the first click, and acts only once confirmed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);
    const { container } = render(
      <ConfirmAction
        label="Remove"
        title="Remove the Slack channel?"
        consequence="Scheduled reports to it stop."
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Scheduled reports to it stop.')).toBeInTheDocument();
    await expectNoBlockingAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('asks for the name to be typed when the action cannot be undone', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAction
        label="Revoke"
        title="Revoke ci-token?"
        consequence="Every job using it is refused from now on."
        typed="ci-token"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    const yes = screen.getByRole('button', { name: 'Yes, revoke' });
    expect(yes).toBeDisabled();
    await user.type(screen.getByLabelText('Type ci-token to confirm'), 'ci-toke');
    expect(yes).toBeDisabled();
    await user.type(screen.getByLabelText('Type ci-token to confirm'), 'n');
    await user.click(yes);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
