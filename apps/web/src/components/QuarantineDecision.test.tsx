import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { QuarantineEntry } from '../lib/api.js';
import { QuarantineDecision } from './QuarantineDecision.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

const entry = (status: QuarantineEntry['status']): QuarantineEntry => ({
  id: 'q-1',
  testTitle: 'checkout',
  testFile: 'checkout.spec.ts',
  reason: null,
  quarantinedAt: '2026-11-01T00:00:00.000Z',
  status,
});

describe('a quarantine decision', () => {
  it('approves a pending entry only with a reason', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn(async () => undefined);
    render(
      <QuarantineDecision entry={entry('pending')} viewerRole="operator" onDecide={onDecide} />,
    );
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = within(screen.getByRole('dialog'));
    const submit = dialog.getByRole('button', { name: 'Approve' });
    expect(submit).toBeDisabled();
    await user.type(dialog.getByLabelText('Reason (required)'), 'flaky on CI, ticket QA-12');
    await user.click(submit);
    expect(onDecide).toHaveBeenCalledWith('approved', 'flaky on CI, ticket QA-12');
  });

  it('offers release for an approved entry, and nothing once it is decided for good', () => {
    const { unmount } = render(
      <QuarantineDecision entry={entry('approved')} viewerRole="admin" onDecide={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    unmount();
    const { container } = render(
      <QuarantineDecision entry={entry('released')} viewerRole="admin" onDecide={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a viewer the controls disabled, saying who decides', () => {
    render(<QuarantineDecision entry={entry('pending')} viewerRole="viewer" onDecide={vi.fn()} />);
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('title', 'An operator or admin decides quarantine');
  });

  it('keeps the dialog open and says why when the API refuses', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn(async () => {
      throw Object.assign(new Error('409'), { detail: 'Invalid quarantine transition' });
    });
    render(
      <QuarantineDecision entry={entry('pending')} viewerRole="operator" onDecide={onDecide} />,
    );
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Reason (required)'), 'real bug');
    await user.click(dialog.getByRole('button', { name: 'Reject' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Invalid quarantine transition');
  });
});
