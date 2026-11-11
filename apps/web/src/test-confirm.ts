import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

/**
 * Clicks a destructive action and confirms it (ledger MNT-185): the button opens a dialog, and
 * only its "Yes, …" button acts. `typed` is the name the dialog asks for, when it asks.
 */
export async function confirmAction(
  user: ReturnType<typeof userEvent.setup>,
  scope: HTMLElement,
  name: string,
  typed?: string,
): Promise<void> {
  await user.click(within(scope).getByRole('button', { name }));
  const dialog = screen.getByRole('dialog');
  if (typed !== undefined) {
    await user.type(within(dialog).getByLabelText(`Type ${typed} to confirm`), typed);
  }
  await user.click(within(dialog).getByRole('button', { name: `Yes, ${name.toLowerCase()}` }));
}
