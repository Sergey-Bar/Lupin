import React from 'react';
import { PALETTE_OPTIONS, Select, isPalette } from '@lupin/ui';
import { PageBody, PageFrame, PageHeader, Panel, Segmented } from './kit.js';
import { useTheme, type Theme } from '../theme/ThemeProvider.js';
import { usePreferences } from '../theme/preferences.js';
import { SetupChecklist, type SetupChecklistSource } from './SetupChecklist.js';

/**
 * Settings — the one place a reader changes how the product behaves.
 *
 * A destination, not a floating modal, so it reuses the no-scroll shell, the manifest,
 * the command palette and the sidebar that every other section uses. Its pages are listed by
 * the sidebar's Settings mode from the manifest; each is its own page under
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
export function SettingsAppearancePage({
  setup,
}: {
  /** The setup line, while setup is unfinished; it left Home so Home is one decision. */
  setup?: SetupChecklistSource;
} = {}): React.ReactElement {
  const { theme, setTheme, palette, setPalette } = useTheme();
  const { preferences, update } = usePreferences();
  return (
    <PageFrame data-testid="settings-appearance-page" className="gap-4 sm:gap-6">
      <PageHeader
        title="Settings"
        subtitle="How the product looks and behaves on this device. Kept in this browser."
      />
      <PageBody>
        {setup === undefined ? null : <SetupChecklist source={setup} />}
        <Panel
          title="Theme"
          action={
            <Segmented<Theme>
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={THEME_OPTIONS}
            />
          }
        >
          <p className="max-w-measure text-sm text-fg-muted">
            The plane and the type. System follows what your operating system is set to, and changes
            with it.
          </p>
        </Panel>

        <Panel
          title="Palette"
          action={
            <Select
              data-testid="palette-select"
              aria-label="Palette"
              containerClassName="w-48"
              value={palette}
              onChange={(event) => {
                if (isPalette(event.target.value)) setPalette(event.target.value);
              }}
              options={PALETTE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          }
        >
          <p className="max-w-measure text-sm text-fg-muted">
            Lupin&rsquo;s own colours, or one of the OpenCode themes. A palette is a dark theme, so
            it holds the dark plane while it is on.
          </p>
        </Panel>

        <Panel
          title="Density"
          action={
            <Segmented<'comfortable' | 'compact'>
              label="Density"
              value={preferences.density}
              onChange={(value) => update({ density: value })}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          }
        >
          <p className="max-w-measure text-sm text-fg-muted">
            Compact scales the whole layout down one step, to fit more on a smaller screen without
            scrolling.
          </p>
        </Panel>

        <Panel
          title="Motion"
          action={
            <Segmented<'full' | 'reduced'>
              label="Motion"
              value={preferences.motion}
              onChange={(value) => update({ motion: value })}
              options={[
                { value: 'full', label: 'Full' },
                { value: 'reduced', label: 'Reduced' },
              ]}
            />
          }
        >
          <p className="max-w-measure text-sm text-fg-muted">
            Reduced holds movement to its floor, for when animation is distracting. It starts from
            your system setting and you can override it here.
          </p>
        </Panel>
      </PageBody>
    </PageFrame>
  );
}
