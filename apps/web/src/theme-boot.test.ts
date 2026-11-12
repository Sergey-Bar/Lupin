import { readFileSync } from 'node:fs';
import { DEFAULT_PALETTE } from './theme/ThemeProvider.js';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The inline script in `index.html` that sets the theme before the first paint.
 *
 * It is run here as text, from the file the browser loads, so the test cannot pass against a
 * copy that has drifted from it. The failure it guards is visible, not subtle: a reader who
 * saved the light theme sees the dark default first and then every element transitions to
 * light, because `ThemeProvider` only sets the attribute in an effect after the first paint.
 */
const html = readFileSync(path.join(import.meta.dirname, '..', 'index.html'), 'utf8');

function bootScript(): string {
  // String search, not a regular expression: an HTML-matching regex is easy to get subtly wrong
  // (case, attributes, spacing), and the file under test is ours with one known inline script.
  const lower = html.toLowerCase();
  const open = lower.indexOf('<script>');
  expect(open, 'index.html has no inline theme script').toBeGreaterThan(-1);
  expect(lower.indexOf('<script>', open + 1), 'index.html has a second inline script').toBe(-1);
  const close = lower.indexOf('</script>', open);
  expect(close, 'the inline theme script is never closed').toBeGreaterThan(open);
  return html.slice(open + '<script>'.length, close);
}

function run(): string | null {
  new Function(bootScript())();
  return document.documentElement.getAttribute('data-theme');
}

function systemPrefers(dark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: dark })),
  );
}

describe('the theme boot script', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    // The light/dark cases below are the Lupin theme's; a palette would force dark.
    localStorage.setItem('lupin-palette', 'lupin');
    document.documentElement.removeAttribute('data-palette');
    vi.unstubAllGlobals();
    systemPrefers(false);
  });

  it('runs before the module that mounts the app, so the first paint is themed', () => {
    const script = html.indexOf('<script>');
    const entry = html.indexOf('<script type="module"');
    expect(script).toBeGreaterThan(-1);
    expect(entry).toBeGreaterThan(script);
  });

  it('paints Lupin’s own palette when nothing is stored, the same default as ThemeProvider', () => {
    localStorage.clear();
    run();
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false);
    // One default, two places: the script before paint and the provider after it.
    expect(DEFAULT_PALETTE).toBe('lupin');
  });

  it('applies a stored OpenCode palette on the dark plane before the first paint', () => {
    localStorage.clear();
    localStorage.setItem('lupin-palette', 'opencode');
    expect(run()).toBe('dark');
    expect(document.documentElement.getAttribute('data-palette')).toBe('opencode');
  });

  it('applies a stored light theme', () => {
    localStorage.setItem('lupin-theme', 'light');
    systemPrefers(true);
    expect(run()).toBe('light');
  });

  it('applies a stored dark theme', () => {
    localStorage.setItem('lupin-theme', 'dark');
    systemPrefers(false);
    expect(run()).toBe('dark');
  });

  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    [null, true, 'dark'],
    [null, false, 'light'],
  ])('follows the operating system for %s when it prefers dark=%s', (stored, dark, expected) => {
    if (stored !== null) localStorage.setItem('lupin-theme', stored);
    systemPrefers(dark);
    expect(run()).toBe(expected);
  });

  it('does not write a stored value it does not recognise', () => {
    // The provider validates this value; so does the script, or `neon` becomes an attribute no
    // stylesheet matches and the page renders in no theme.
    localStorage.setItem('lupin-theme', 'neon');
    systemPrefers(true);
    expect(run()).toBe('dark');
  });

  it('falls back to light when the browser cannot say', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(run()).toBe('light');
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => run()).not.toThrow();
    // Nothing was set, so the provider's own effect decides once the app mounts.
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    vi.restoreAllMocks();
  });
});
