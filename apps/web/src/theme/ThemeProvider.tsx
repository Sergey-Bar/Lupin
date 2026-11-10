import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { isPalette, type Palette } from '@lupin/ui';

export type Theme = 'dark' | 'light' | 'system';

/** The three themes, in a form a runtime check can use. */
const THEMES: readonly Theme[] = ['dark', 'light', 'system'];

export interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** An OpenCode palette, or `lupin` for the product's own theme. */
  palette: Palette;
  setPalette: (palette: Palette) => void;
}

export const PALETTE_STORAGE_KEY = 'lupin-palette';

/** Lupin's own violet is the default look; the OpenCode palettes stay one choice away in Settings. */
export const DEFAULT_PALETTE: Palette = 'lupin';

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'lupin-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme;
    // Validated, not cast. `localStorage` is not a trusted input: a value left by
    // an older build, written by a different tab, or edited by hand lands here
    // verbatim, and the effect below writes it straight to `data-theme` — so an
    // arbitrary string became an attribute no stylesheet matches, and the page
    // rendered in no theme at all with nothing in the console to say why.
    const stored = localStorage.getItem(storageKey);
    return stored && THEMES.includes(stored as Theme) ? (stored as Theme) : defaultTheme;
  });

  const [palette, setPaletteState] = useState<Palette>(() => {
    if (typeof window === 'undefined') return DEFAULT_PALETTE;
    // Validated like the theme: an unknown stored name would match no stylesheet.
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(stored) ? stored : DEFAULT_PALETTE;
  });

  useEffect(() => {
    // `window` is checked *here* rather than above, where the previous version had
    // it: the effect runs in the browser, and the initialiser above already handles
    // the absent-`window` case. Guarding at the top of this effect was unreachable
    // — line 31 would have thrown first — so it read as SSR safety that did not
    // exist.
    if (typeof window === 'undefined') return;
    const root = window.document.documentElement;
    // A palette is a dark theme, so it holds the dark plane whatever the light/dark choice is.
    if (palette !== 'lupin') {
      root.setAttribute('data-palette', palette);
      root.setAttribute('data-theme', 'dark');
      return;
    }
    root.removeAttribute('data-palette');
    if (theme !== 'system') {
      root.setAttribute('data-theme', theme);
      return;
    }

    // In system mode the OS is the source of truth, so this subscribes rather than
    // asking once.
    //
    // It used to ask once and return, which meant a reader on the default theme —
    // the only setting that promises to follow the system — got the answer at page
    // load and nothing after it. Switching the OS to dark at 6pm left them on a
    // white page until they reloaded, and nothing looked wrong (ledger W-9).
    if (typeof window === 'undefined' || !window.matchMedia) {
      root.setAttribute('data-theme', 'light');
      return;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    // One named handler, referenced by both `addEventListener` and the cleanup.
    // A second arrow in the cleanup would not be the same function, so
    // `removeEventListener` would silently do nothing and the listener would
    // outlive the provider.
    const onChange = (event: MediaQueryListEvent) =>
      root.setAttribute('data-theme', event.matches ? 'dark' : 'light');
    root.setAttribute('data-theme', query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    // Unsubscribed, or a provider that unmounts and remounts — which a route
    // change does — leaves a listener behind holding a closure for the life of
    // the page, and each of them would write the attribute again.
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, [theme, palette]);

  const setPalette = (next: Palette) => {
    if (typeof window !== 'undefined') localStorage.setItem(PALETTE_STORAGE_KEY, next);
    setPaletteState(next);
  };

  const setTheme = (newTheme: Theme) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, newTheme);
    }
    setThemeState(newTheme);
  };

  const value = {
    theme,
    setTheme,
    palette,
    setPalette,
  };

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
