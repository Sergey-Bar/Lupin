import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from './Checkbox.js';

describe('Checkbox', () => {
  it('is a real checkbox, by role and by name', () => {
    render(<Checkbox aria-label="Select all" />);
    expect(screen.getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
  });

  it('toggles from a click and reports it', async () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="One" onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'One' }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByRole('checkbox', { name: 'One' })).toBeChecked();
  });

  it('toggles from the keyboard', async () => {
    render(<Checkbox aria-label="One" />);
    await userEvent.tab();
    expect(screen.getByRole('checkbox', { name: 'One' })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'One' })).toBeChecked();
  });

  it('follows a controlled value', () => {
    const { rerender } = render(<Checkbox aria-label="One" checked onChange={() => undefined} />);
    expect(screen.getByRole('checkbox', { name: 'One' })).toBeChecked();
    rerender(<Checkbox aria-label="One" checked={false} onChange={() => undefined} />);
    expect(screen.getByRole('checkbox', { name: 'One' })).not.toBeChecked();
  });

  it('does not toggle when disabled', async () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="One" disabled onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'One' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('exposes a mixed state through the input’s own indeterminate property', () => {
    render(<Checkbox aria-label="Some" indeterminate />);
    // The platform maps `indeterminate` to "mixed" itself; `aria-checked` on a native checkbox
    // would be a second statement of the same fact, and axe rejects it.
    const box = screen.getByRole('checkbox', { name: 'Some' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box).not.toHaveAttribute('aria-checked');
  });

  it('forwards its ref to the input, as a function or an object', () => {
    const object = createRef<HTMLInputElement>();
    const callback = vi.fn();
    render(
      <>
        <Checkbox aria-label="A" ref={object} />
        <Checkbox aria-label="B" ref={callback} />
      </>,
    );
    expect(object.current).toBe(screen.getByRole('checkbox', { name: 'A' }));
    expect(callback).toHaveBeenCalledWith(screen.getByRole('checkbox', { name: 'B' }));
  });

  it('draws its box from the input’s own state, not from a copy of it', () => {
    const { container } = render(<Checkbox aria-label="One" />);
    const drawn = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    // Every state is a `peer-*` variant of the input, so there is no second "checked" to drift.
    for (const variant of ['peer-checked:', 'peer-focus-visible:', 'peer-disabled:']) {
      expect(drawn.className).toContain(variant);
    }
  });

  it('stretches the hit area past the box', () => {
    render(<Checkbox aria-label="One" />);
    expect(screen.getByRole('checkbox', { name: 'One' })).toHaveClass('-inset-2.5');
  });
});
