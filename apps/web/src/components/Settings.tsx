import React from 'react';
import { PageBody, PageFrame, PageHeader, Panel, Segmented } from './kit.js';
import { useTheme, type Theme } from '../theme/ThemeProvider.js';
import { usePreferences } from '../theme/preferences.js';

/**
 * Settings — the one place a reader changes how the product behaves.
 *
 * A destination, not a floating modal, so it reuses the no-scroll shell, the manifest,
 * the command palette and the section tab row that every other section uses. The tabs
 * are listed by the sidebar (`NavBar`) from the manifest; each tab is its own page under
 * `/dashboard/settings/*`. Appearance is the landing, because it is the one surface every
 * reader may change regardless of role.
 */

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

/**
 * Appearance: theme, and the three quiet modes. Each control writes the context the shell
 * already reads (`useTheme` sets `data-theme`; `usePreferences` sets `data-focus`,
 * `data-density`, `data-motion` on `<html>`), so the change is visible the instant it is
 * made and is kept per browser — the right scope for a desktop instrument where each device
 * reads the way it needs. This is the first surface that gathers all four in one place;
 * until now focus, density and motion were only reachable from the command palette.
 */
export function SettingsAppearancePage(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const { preferences, update } = usePreferences();
  return (
    <PageFrame data-testid="settings-appearance-page" className="gap-4 sm:gap-6">
      <PageHeader
        title="Settings"
        subtitle="How the product looks and behaves on this device. Kept in this browser."
      />
      <PageBody>
        <Panel title="Theme">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-measure text-sm text-fg-muted">
              The plane and the type. System follows what your operating system is set to, and
              changes with it.
            </p>
            <Segmented<Theme>
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={THEME_OPTIONS}
            />
          </div>
        </Panel>

        <Panel title="Focus">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-measure text-sm text-fg-muted">
              Hide the secondary navigation so a page is the page and nothing else. The command
              palette and the keyboard shortcuts still reach everywhere.
            </p>
            <Segmented<'on' | 'off'>
              label="Focus mode"
              value={preferences.focus ? 'on' : 'off'}
              onChange={(value) => update({ focus: value === 'on' })}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Density">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-measure text-sm text-fg-muted">
              Compact scales the whole layout down one step, to fit more on a smaller screen without
              scrolling.
            </p>
            <Segmented<'comfortable' | 'compact'>
              label="Density"
              value={preferences.density}
              onChange={(value) => update({ density: value })}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Motion">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-measure text-sm text-fg-muted">
              Reduced holds movement to its floor, for when animation is distracting. It starts from
              your system setting and you can override it here.
            </p>
            <Segmented<'full' | 'reduced'>
              label="Motion"
              value={preferences.motion}
              onChange={(value) => update({ motion: value })}
              options={[
                { value: 'full', label: 'Full' },
                { value: 'reduced', label: 'Reduced' },
              ]}
            />
          </div>
        </Panel>
      </PageBody>
    </PageFrame>
  );
}
