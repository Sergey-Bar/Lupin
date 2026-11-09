/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SettingsAppearancePage } from './Settings';
import { ThemeProvider } from '../theme/ThemeProvider';
import { PreferencesProvider, PREFERENCES_KEY } from '../theme/preferences';
import { expectNoBlockingAxeViolations } from '../test-axe';

function renderAppearance() {
  return render(
    <ThemeProvider>
      <PreferencesProvider>
        <SettingsAppearancePage />
      </PreferencesProvider>
    </ThemeProvider>,
  );
}

/** The pressed pill of a named segmented group. */
function pressed(groupLabel: string): string | null {
  const group = screen.getByRole('group', { name: groupLabel });
  const active = within(group)
    .getAllByRole('button')
    .find((button) => button.getAttribute('aria-pressed') === 'true');
  return active?.textContent ?? null;
}

describe('Settings · Appearance', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-density');
    document.documentElement.removeAttribute('data-motion');
    document.documentElement.removeAttribute('data-focus');
    document.documentElement.removeAttribute('data-palette');
  });

  it('renders a titled Settings page on the no-scroll kit', () => {
    renderAppearance();
    expect(screen.getByTestId('settings-appearance-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('puts each control on its title row, so every setting reads the same way', () => {
    renderAppearance();
    for (const name of ['Theme', 'Focus', 'Density', 'Motion']) {
      const heading = screen.getByRole('heading', { name });
      const row = heading.parentElement;
      expect(row, name).not.toBeNull();
      // The segmented control is a sibling of the heading, not a block below the description.
      expect(
        row?.querySelector('[role="radiogroup"], [role="tablist"], [role="group"]'),
        name,
      ).not.toBeNull();
    }
  });

  it('reflects the stored theme and writes the chosen one to localStorage and <html>', () => {
    localStorage.setItem('lupin-theme', 'light');
    renderAppearance();
    expect(pressed('Theme')).toBe('Light');
    fireEvent.click(within(screen.getByRole('group', { name: 'Theme' })).getByText('Dark'));
    expect(localStorage.getItem('lupin-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('keeps the reader’s QA role, so Now leads with what they do first', () => {
    renderAppearance();
    fireEvent.click(within(screen.getByRole('group', { name: 'Your role' })).getByText('QA lead'));
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}').persona).toBe('lead');
  });

  it('toggles focus mode and sets data-focus on <html>', () => {
    renderAppearance();
    expect(pressed('Focus mode')).toBe('Off');
    fireEvent.click(within(screen.getByRole('group', { name: 'Focus mode' })).getByText('On'));
    expect(document.documentElement.dataset['focus']).toBe('on');
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}').focus).toBe(true);
  });

  it('sets compact density on <html> when chosen', () => {
    renderAppearance();
    expect(pressed('Density')).toBe('Comfortable');
    fireEvent.click(within(screen.getByRole('group', { name: 'Density' })).getByText('Compact'));
    expect(document.documentElement.dataset['density']).toBe('compact');
  });

  it('reduces motion on <html> when chosen', () => {
    renderAppearance();
    fireEvent.click(within(screen.getByRole('group', { name: 'Motion' })).getByText('Reduced'));
    expect(document.documentElement.dataset['motion']).toBe('reduced');
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = renderAppearance();
    await expectNoBlockingAxeViolations(container);
  });
  it('switches to an OpenCode palette from the Palette setting', () => {
    renderAppearance();
    fireEvent.change(screen.getByRole('combobox', { name: 'Palette' }), {
      target: { value: 'catppuccin' },
    });
    expect(document.documentElement.getAttribute('data-palette')).toBe('catppuccin');
    expect(localStorage.getItem('lupin-palette')).toBe('catppuccin');
  });
});
