import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MasterDetail } from './MasterDetail.js';

const ITEMS = Array.from({ length: 11 }, (_, index) => ({
  id: `i${String(index + 1)}`,
  name: `Item ${String(index + 1)}`,
}));

function Harness({ items = ITEMS }: { items?: typeof ITEMS }) {
  return (
    <MasterDetail
      label="things"
      title={`${String(items.length)} things`}
      items={items}
      getKey={(item) => item.id}
      rowPx={64}
      renderRow={(item) => <span>{item.name}</span>}
      renderDetail={(item) => <div data-testid="detail">Detail of {item.name}</div>}
    />
  );
}

describe('MasterDetail', () => {
  it('opens the first item, pages the rest, and says which rows are shown', async () => {
    render(<Harness />);
    expect(screen.getByTestId('detail')).toHaveTextContent('Detail of Item 1');
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByText('1–8 of 11')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next things page' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    // The selection survives a page turn.
    expect(screen.getByTestId('detail')).toHaveTextContent('Detail of Item 1');
  });

  it('selects on click and on focus, and marks the current row', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Item 3' }));
    expect(screen.getByTestId('detail')).toHaveTextContent('Detail of Item 3');
    expect(screen.getByRole('button', { name: 'Item 3' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Item 1' })).not.toHaveAttribute('aria-current');
    // Focus alone selects: that is how j and k browse. They give a row tabindex -1 first.
    const row = screen.getByRole('button', { name: 'Item 5' }).closest('li')!;
    row.tabIndex = -1;
    row.focus();
    expect(await screen.findByText('Detail of Item 5')).toBeInTheDocument();
  });

  it('falls back to the first item when the selected one is filtered away', async () => {
    const { rerender } = render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Item 4' }));
    rerender(<Harness items={ITEMS.filter((item) => item.id !== 'i4')} />);
    expect(screen.getByTestId('detail')).toHaveTextContent('Detail of Item 1');
  });

  it('keeps the detail free of list items, so j and k walk only the rows', () => {
    render(<Harness />);
    const detail = screen.getByRole('region', { name: 'Selected thing' });
    expect(within(detail).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('opens the detail in place of the list on a narrow screen, and goes back', async () => {
    render(<Harness />);
    const back = screen.getByRole('button', { name: 'Back to the list' });
    expect(back).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Item 2' }));
    expect(screen.getByRole('region', { name: 'Selected thing' })).toHaveClass('flex');
    await userEvent.click(back);
    expect(screen.getByRole('region', { name: 'Selected thing' })).toHaveClass('hidden');
  });
});
