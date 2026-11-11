import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalCommandPalette } from './GlobalCommandPalette.js';
import { commandStore } from '../hooks/useCommandActions.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { matchActions } from '@lupin/ui';

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

describe('GlobalCommandPalette', () => {
  beforeEach(() => {
    commandStore.clear();
    mockNavigate.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers the questions a QA person asks, each with the page that answers it', () => {
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    const ask = (question: string) => matchActions(commandStore.getActions(), question)[0];
    for (const [question, to] of [
      ['can we ship', '/dashboard'],
      ['is the release ready', '/dashboard'],
      ['which tests are flaky', '/dashboard/insights'],
      ['why did main fail', '/dashboard/now'],
      ['slowest tests', '/dashboard/insights'],
      ['where are the coverage gaps', '/dashboard'],
    ] as const) {
      const action = ask(question);
      expect(action, question).toBeDefined();
      mockNavigate.mockClear();
      act(() => action?.onSelect());
      expect(mockNavigate, question).toHaveBeenCalledWith({ to });
    }
  });

  it('opens on Ctrl+K', () => {
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    expect(screen.queryByPlaceholderText('Type a command or search...')).toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(screen.queryByPlaceholderText('Type a command or search...')).toBeTruthy();
  });

  it('deregisters actions on unmount', () => {
    const { unmount } = render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    expect(commandStore.getActions().length).toBeGreaterThan(0);
    unmount();
    expect(commandStore.getActions()).toHaveLength(0);
  });

  it('toggles theme from system to dark', () => {
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    act(() => {
      commandStore
        .getActions()
        .find((action) => action.id === 'theme-toggle')
        ?.onSelect();
    });
    expect(localStorage.getItem('lupin-theme')).toBe('dark');
  });

  it('toggles theme from dark to light', () => {
    localStorage.setItem('lupin-theme', 'dark');
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    act(() => {
      commandStore
        .getActions()
        .find((action) => action.id === 'theme-toggle')
        ?.onSelect();
    });
    expect(localStorage.getItem('lupin-theme')).toBe('light');
  });
});

describe('GlobalCommandPalette keyboard and accessibility', () => {
  beforeEach(() => {
    commandStore.clear();
    mockNavigate.mockClear();
    localStorage.clear();
  });

  it('opens from a real Ctrl+K keystroke and moves focus into the search field', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );

    await user.keyboard('{Control>}k{/Control}');

    // The built-in actions are registered, so the palette has something to show;
    // focus landing in the field is what makes the arrow keys usable at all.
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
  });

  it('presents the palette as a combobox over a listbox of the registered actions', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );

    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    const labels = screen.getAllByRole('option').map((option) => option.textContent);
    expect(labels).toEqual(
      // No 'Sign Out': signing out is on the Access page, beside the sign-in it ends.
      expect.arrayContaining(['Go to Overview', 'Go to Runs', 'Go to Map', 'Toggle Theme']),
    );
    expect(labels).not.toContain('Sign Out');
  });

  it('runs the highlighted action with Enter', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );

    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    // Index 0 is "Go to Now", 1 is "Go to Portfolio"; two ArrowDowns reach the project overview.
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('dismisses on Escape and returns focus to the element that opened it', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" data-testid="page-control">
          Open the palette from here
        </button>
        <ThemeProvider>
          <GlobalCommandPalette />
        </ThemeProvider>
      </div>,
    );

    const trigger = screen.getByTestId('page-control');
    await user.click(trigger);
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('has no serious or critical axe violations once open', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );

    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox');

    await expectNoBlockingAxeViolations(container);
  });
});
