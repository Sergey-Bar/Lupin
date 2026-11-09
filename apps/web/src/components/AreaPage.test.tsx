import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AreaPage, type AreaItem } from './AreaPage.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';

const item = (id: string, overrides: Partial<AreaItem> = {}): AreaItem => ({
  id,
  title: `item ${id}`,
  detail: 'why it matters',
  tone: 'bad',
  action: { label: 'Open', to: `/x/${id}` },
  ...overrides,
});

function show(items: AreaItem[], extra: Partial<React.ComponentProps<typeof AreaPage>> = {}) {
  const navigate = vi.fn();
  const view = render(
    <AreaPage
      title="Tests"
      verdict="Two tests need a decision."
      items={items}
      navigate={navigate}
      {...extra}
    />,
  );
  return { navigate, ...view };
}

describe('AreaPage', () => {
  it('says the verdict in one sentence under the title', () => {
    show([item('a')]);
    expect(screen.getByRole('heading', { level: 1, name: 'Tests' })).toBeInTheDocument();
    expect(screen.getByTestId('area-verdict')).toHaveTextContent('Two tests need a decision.');
  });

  it('shows at most three items, and folds the rest behind one quiet line', () => {
    show(['a', 'b', 'c', 'd', 'e'].map((id) => item(id)));
    expect(screen.getAllByTestId(/^area-item-/u)).toHaveLength(3);
    const rest = screen.getByTestId('area-rest');
    expect(rest.tagName).toBe('DETAILS');
    expect(rest).not.toHaveAttribute('open');
    expect(rest).toHaveTextContent('2 more when you are ready');
  });

  it('has exactly one primary button on the screen, on the first item', () => {
    const { container } = show(['a', 'b', 'c'].map((id) => item(id)));
    expect(container.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    expect(
      within(screen.getByTestId('area-item-a')).getByRole('button', { name: 'Open' }),
    ).toHaveAttribute('data-primary', 'true');
  });

  it('puts a word beside every dot, so colour is never the only signal', () => {
    show([item('a', { tone: 'bad' }), item('b', { tone: 'warn' })]);
    expect(screen.getByTestId('area-item-a')).toHaveTextContent('Needs you');
    expect(screen.getByTestId('area-item-b')).toHaveTextContent('Worth a look');
  });

  it('marks what is new since the last visit', () => {
    localStorage.setItem('lupin-area-tests', '2026-11-01T00:00:00.000Z');
    show([
      item('a', { at: '2026-11-08T00:00:00.000Z' }),
      item('b', { at: '2026-10-01T00:00:00.000Z' }),
    ]);
    expect(within(screen.getByTestId('area-item-a')).getByText('new')).toBeInTheDocument();
    expect(within(screen.getByTestId('area-item-b')).queryByText('new')).toBeNull();
    localStorage.clear();
  });

  it('runs an automatic action, shows progress, and lets the item leave when it is done', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((done) => (finish = done)));
    show([item('a', { action: { label: 'Quarantine', run } })]);
    await user.click(screen.getByRole('button', { name: 'Quarantine' }));
    expect(screen.getByRole('button', { name: 'Quarantining' })).toBeDisabled();
    finish();
    expect(await screen.findByRole('status')).toHaveTextContent('Done: item a');
  });

  it('keeps the item and says why when the automatic action is refused', async () => {
    const user = userEvent.setup();
    show([
      item('a', {
        action: { label: 'Quarantine', run: async () => Promise.reject(new Error('Forbidden')) },
      }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Quarantine' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.getByTestId('area-item-a')).toBeInTheDocument();
  });

  it('navigates for a plain action', async () => {
    const user = userEvent.setup();
    const { navigate } = show([item('a')]);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(navigate).toHaveBeenCalledWith('/x/a');
  });

  it('says all clear when there is nothing to do, and keeps the details reachable', () => {
    show([], { details: <p>raw numbers</p>, clear: 'Every test is steady.' });
    expect(screen.getByTestId('area-clear')).toHaveTextContent('Every test is steady.');
    const details = screen.getByTestId('area-details');
    expect(details.tagName).toBe('DETAILS');
    expect(details).toHaveTextContent('raw numbers');
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = show(
      ['a', 'b', 'c', 'd'].map((id) => item(id)),
      { details: <p>numbers</p> },
    );
    await expectNoBlockingAxeViolations(container);
  });
});
