import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuButton } from './MenuButton.js';

const ITEMS = [
  { value: 'comment', label: 'Comment' },
  { value: 'close', label: 'Close' },
  { value: 'merge', label: 'Merge', disabled: true },
  { value: 'label', label: 'Add label' },
];

function setup(onSelect = vi.fn()) {
  render(
    <>
      <button type="button">before</button>
      <MenuButton label="Actions for octo/service#1" items={ITEMS} onSelect={onSelect} />
      <button type="button">after</button>
    </>,
  );
  return { onSelect, trigger: screen.getByRole('button', { name: 'Actions for octo/service#1' }) };
}

describe('MenuButton', () => {
  it('is a menu button that starts closed', () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens a named menu of items and moves focus to the first enabled one', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Actions for octo/service#1' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
    expect(screen.getByRole('menuitem', { name: 'Comment' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('menu').id);
  });

  it('opens from the keyboard with ArrowDown', async () => {
    const { trigger } = setup();
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('walks the enabled items with the arrows, wrapping and skipping the disabled one', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    // "Merge" is disabled, so the walk goes straight to "Add label".
    expect(screen.getByRole('menuitem', { name: 'Add label' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Comment' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Add label' })).toHaveFocus();
  });

  it('jumps to the ends with Home and End', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Add label' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'Comment' })).toHaveFocus();
  });

  it('reports the chosen value, closes, and returns focus to the trigger', async () => {
    const { trigger, onSelect } = setup();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('close');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('chooses with Enter', async () => {
    const { trigger, onSelect } = setup();
    await userEvent.click(trigger);
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('comment');
  });

  it('does not offer a disabled item', async () => {
    const { trigger, onSelect } = setup();
    await userEvent.click(trigger);
    const merge = screen.getByRole('menuitem', { name: 'Merge' });
    expect(merge).toBeDisabled();
    await userEvent.click(merge);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape and gives focus back', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on Tab and lets focus continue past the menu', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    await userEvent.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it('closes on a press outside, without stealing focus', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'after' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });

  it('toggles closed when the trigger is pressed again', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('is disabled when nothing in it can be chosen', () => {
    render(
      <MenuButton
        label="Actions"
        items={[{ value: 'a', label: 'A', disabled: true }]}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Actions' })).toBeDisabled();
  });

  it('is disabled when told to be', () => {
    render(<MenuButton label="Actions" items={ITEMS} onSelect={() => undefined} disabled />);
    expect(screen.getByRole('button', { name: 'Actions' })).toBeDisabled();
  });

  it('shows what it was given as the trigger content', () => {
    render(
      <MenuButton label="Sort" items={ITEMS} onSelect={() => undefined}>
        Newest
      </MenuButton>,
    );
    expect(screen.getByRole('button', { name: 'Sort' })).toHaveTextContent('Newest');
  });

  it('opens on the overlay material and the anchored entrance, as an overlay does', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu).toHaveClass('surface-translucent', 'animate-zoom-in-95', 'fixed');
  });
});
