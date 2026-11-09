import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LABELS, PALETTES, render } from './palettes.source.mjs';
import { PALETTE_OPTIONS } from './palettes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the OpenCode palettes', () => {
  it('ships the CSS its source generates, so a palette cannot drift from its hex', () => {
    // Compared without whitespace: Prettier owns the layout, the generator owns the values.
    const squash = (css: string) => css.replace(/\s+/gu, '');
    expect(squash(readFileSync(path.join(here, 'palettes.css'), 'utf8'))).toBe(squash(render()));
  });

  it('offers at least the dozen best-known OpenCode themes, OpenCode first', () => {
    const names = Object.keys(PALETTES);
    expect(names[0]).toBe('opencode');
    expect(names.length).toBeGreaterThanOrEqual(12);
  });

  it('lists the same palettes, with the same labels, in the picker as in the stylesheet', () => {
    expect(PALETTE_OPTIONS.slice(1).map((option) => option.value)).toEqual(Object.keys(PALETTES));
    for (const option of PALETTE_OPTIONS.slice(1)) expect(option.label).toBe(LABELS[option.value]);
    expect(PALETTE_OPTIONS[0].value).toBe('lupin');
  });

  it('draws card edges a step off the surface, so panels read as blocks, not outlines', () => {
    const css = readFileSync(path.join(here, 'palettes.css'), 'utf8').replace(/\s+/gu, ' ');
    for (const block of css.split('[data-palette=').slice(1)) {
      const border = /--lupin-border: (oklch\([^)]+\))/u.exec(block)?.[1];
      const muted = /--lupin-surface-muted: (oklch\([^)]+\))/u.exec(block)?.[1];
      expect(border).toBe(muted);
    }
  });

  for (const [name, p] of Object.entries(PALETTES)) {
    const [sunken, surface, raised, muted, fg, fgMuted, , borderStrong, accent, ...status] = p;
    it(`${name}: text clears 4.5:1 on every plane step`, () => {
      for (const plane of [sunken, surface, raised, muted]) {
        expect(contrast(fg, plane), `fg on ${plane}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const plane of [sunken, surface, raised]) {
        expect(contrast(fgMuted, plane), `muted on ${plane}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${name}: the accent and every verdict read as text, and the primary fill has a legible label`, () => {
      for (const colour of [accent, ...status]) {
        expect(contrast(colour, surface), `${colour} on surface`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(sunken, accent), 'label on the accent fill').toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: a control edge clears 3:1 (WCAG 1.4.11)`, () => {
      expect(contrast(borderStrong, surface)).toBeGreaterThanOrEqual(3);
    });
  }
});
