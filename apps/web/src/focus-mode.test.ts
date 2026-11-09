import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Focus mode is one stylesheet rule and the components that opt into it. The rule hid the
 * mobile tab rows only, so on a desktop, where those rows are already hidden, turning focus
 * on changed nothing a person could see. This holds the rule to what it promises.
 */
const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.css'),
  'utf8',
);

describe('focus mode', () => {
  it('hides whatever is marked secondary chrome', () => {
    expect(css).toMatch(
      /html\[data-focus='on'\] \[data-chrome='secondary'\]\s*\{\s*display: none;/u,
    );
  });

  it('beats a display utility on the element, so it sits outside every cascade layer', () => {
    // Inside `@layer base` the rule lost to `grid` or `flex` on the same element (utilities
    // are a later layer), and the setup line and the "Then" list stayed on screen.
    const layered = [...css.matchAll(/@layer [a-z]+ \{([\s\S]*?)\n\}/gu)].map((m) => m[1] ?? '');
    expect(layered.some((block) => block.includes("[data-chrome='secondary']"))).toBe(false);
  });

  it('narrows the reading column, so the one thing left sits where the eye already is', () => {
    expect(css).toMatch(/html\[data-focus='on'\] \[data-focus-column\]\s*\{[^}]*max-width:/u);
  });
});
