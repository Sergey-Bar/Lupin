import React from 'react';
import { type PersonaId } from '../lib/persona.js';

/**
 * Three ways to make the dashboard quieter, kept beside the theme and persisted per browser.
 *
 *  - **Focus** puts away everything but each page's one thing to do (recent runs, the "then"
 *    list, folded extras, the numbers, the setup line) and centres what is left. The sidebar's
 *    focus button, the command palette and Settings all toggle it.
 *  - **Density** compact scales the whole rem-based layout down by one step.
 *  - **Motion** reduced sets the one motion multiplier `motion.css` reads to its floor. It
 *    starts from the operating system's `prefers-reduced-motion`, and a person can override it.
 *
 * Each is a `data-*` attribute on `<html>` that `index.css` reads, so no component needs to
 * know about any of them and every token keeps its meaning.
 */
export interface Preferences {
  focus: boolean;
  density: 'comfortable' | 'compact';
  motion: 'full' | 'reduced';
  /** The reader's QA role, which decides what Now leads with; `null` until chosen. */
  persona: PersonaId | null;
}

export const PREFERENCES_KEY = 'lupin-preferences';

function systemMotion(): Preferences['motion'] {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    ? 'reduced'
    : 'full';
}

/** Validated rather than cast: localStorage is a string anyone can edit. */
export function readPreferences(raw: string | null): Preferences {
  const defaults: Preferences = {
    focus: false,
    density: 'comfortable',
    motion: systemMotion(),
    persona: null,
  };
  if (raw === null) return defaults;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      focus: false,
      density: parsed['density'] === 'compact' ? 'compact' : 'comfortable',
      motion:
        parsed['motion'] === 'reduced' || parsed['motion'] === 'full'
          ? parsed['motion']
          : defaults.motion,
      // Focus mode and the QA roles were removed; a value an older build stored is ignored, so
      // nobody is held in a mode or an order there is no longer a control for.
      persona: null,
    };
  } catch {
    return defaults;
  }
}

interface PreferencesState {
  preferences: Preferences;
  update: (change: Partial<Preferences>) => void;
}

const PreferencesContext = React.createContext<PreferencesState>({
  preferences: { focus: false, density: 'comfortable', motion: 'full', persona: null },
  update: () => undefined,
});

export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [preferences, setPreferences] = React.useState<Preferences>(() =>
    readPreferences(localStorage.getItem(PREFERENCES_KEY)),
  );
  React.useEffect(() => {
    const root = document.documentElement;
    root.dataset['focus'] = preferences.focus ? 'on' : 'off';
    root.dataset['density'] = preferences.density;
    root.dataset['motion'] = preferences.motion;
  }, [preferences]);
  const update = React.useCallback((change: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change };
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const value = React.useMemo(() => ({ preferences, update }), [preferences, update]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesState {
  return React.useContext(PreferencesContext);
}
