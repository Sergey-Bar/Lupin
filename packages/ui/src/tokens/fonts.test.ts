import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The font lock, in both directions, and the preload list beside it.
 *
 * Three claims are checked here and none of them is "the font looks right":
 *
 *  1. **Every committed binary is in `fonts-lock.json` and every row names a
 *     file that exists.** The first direction is the one that matters — a font
 *     nobody recorded is a font nobody checked, and a lock file with a row for a
 *     file that was deleted is a claim about nothing.
 *  2. **Each file's sha256 matches the recorded digest.** A hash answers *did
 *     the file change*. It does not answer *is the file safe*, which is why the
 *     upstream URL and version sit beside it in the lock: replacing a binary
 *     requires editing a row a reviewer reads.
 *  3. **`index.html` preloads exactly the locked files**, with `crossorigin` and
 *     `type="font/woff2"`. A preload missing `crossorigin` is fetched twice —
 *     once in CORS mode by the preload and once without it by the `@font-face`,
 *     and the browser keeps both — so the attribute is asserted rather than left
 *     to review.
 *
 * ## What this file does not check, and why that is stated
 *
 * The metrics block in the lock is a **link, not a measurement.** A test cannot
 * read a woff2's `hhea` table, so `ascent-override` / `descent-override` /
 * `line-gap-override` / `size-adjust` are asserted against the numbers recorded
 * in the lock, and the lock records where those numbers came from — read out of
 * each face's `hhea` table at `unitsPerEm` 1000. That is the honest boundary: the
 * test stops someone re-tuning the overrides without re-measuring, and a reviewer
 * of the lock checks the measurement itself. A test that claimed to have measured
 * a font would be claiming more than it does.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDirectory = path.join(here, '../assets/fonts');
const lockPath = path.join(here, '../assets/fonts-lock.json');
const webRoot = path.resolve(here, '../../../..');

const fontsCss = readFileSync(path.join(here, 'fonts.css'), 'utf8');
const indexCss = readFileSync(path.join(webRoot, 'apps/web/src/index.css'), 'utf8');
const indexHtml = readFileSync(path.join(webRoot, 'apps/web/index.html'), 'utf8');

interface LockedFont {
  family: string;
  file: string;
  upstream: string;
  revision: string;
  source: string;
  licence: string;
  licenceFile: string;
  axes: Record<string, string>;
  unicodeRange: string;
  sha256: string;
}

interface MeasuredMetrics {
  ascent: number;
  descent: number;
  lineGap: number;
  xHeight: number;
  capHeight: number;
  fallbackFace: string;
  fallbackXHeightPerCent: number;
}

interface LockDocument {
  fonts: LockedFont[];
  unitsPerEm: number;
  measuredMetrics: Record<string, MeasuredMetrics>;
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as LockDocument;
const unitsPerEm = lock.unitsPerEm;

/** The `@font-face` block naming `family`, or `undefined`. */
function fontFaceFor(family: string): string | undefined {
  const pattern = new RegExp(
    `@font-face\\s*\\{[^}]*font-family:\\s*['"]${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"][^}]*\\}`,
    's',
  );
  return pattern.exec(fontsCss)?.[0];
}

/** The metrics-override `@font-face` block for a fallback family. */
function fallbackFaceFor(family: string): string | undefined {
  return fontFaceFor(family);
}

function normaliseRange(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Whether `block` declares `src: url("<path>") format("<format>")`. */
function declaresSrc(block: string, path: string, format: string): boolean {
  return block.includes(`src: url('${path}') format('${format}');`);
}

describe('the committed font binaries', () => {
  it('locks every file in the fonts directory, and every row names a real file', () => {
    // Both directions, in one assertion, because either half alone is satisfied
    // by a directory and a lock file that disagree.
    const committed = readdirSync(fontsDirectory).sort();
    const recorded = lock.fonts.map((font) => font.file).sort();
    expect(committed, 'a font binary has no row in fonts-lock.json').toEqual(recorded);
    for (const font of lock.fonts) {
      expect(
        existsSync(path.join(fontsDirectory, font.file)),
        `fonts-lock.json records ${font.file}, which is not in the directory`,
      ).toBe(true);
    }
  });

  it.each(lock.fonts.map((font) => [font.family, font] as const))(
    'ships %s at the digest the lock records',
    (_family, font) => {
      const bytes = readFileSync(path.join(fontsDirectory, font.file));
      // `wOF2`, not `wOF` and not a text file renamed. A truncated download or an
      // HTML error page saved under a `.woff2` name would otherwise be recorded
      // with a digest and pass every other assertion here.
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(font.sha256);
    },
  );

  it.each(lock.fonts.map((font) => [font.family, font] as const))(
    'records where %s came from, because a hash is not a provenance',
    (_family, font) => {
      // An upstream repository and the commit the file was taken from: a branch name
      // or a "latest" moves, and a 40-character revision does not.
      expect(font.upstream).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
      expect(font.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(font.source.length).toBeGreaterThan(0);
      expect(font.licence).toContain('SIL Open Font License');
      // The OFL requires the licence to travel with the font, so its text is committed
      // beside the binaries rather than left upstream.
      const licence = readFileSync(path.join(fontsDirectory, '..', font.licenceFile), 'utf8');
      expect(licence).toMatch(/SIL OPEN FONT LICENSE/i);
    },
  );
});

describe('fonts.css declares each locked face', () => {
  it.each(lock.fonts.map((font) => [font.family, font] as const))(
    'declares %s with swap, woff2, and the axes the lock records',
    (family, font) => {
      const block = fontFaceFor(family);
      expect(block, `fonts.css declares no @font-face for ${family}`).toBeDefined();
      const face = block ?? '';
      expect(face).toContain('font-display: swap');
      expect(
        declaresSrc(face, `../assets/fonts/${font.file}`, 'woff2'),
        `${family} does not load ${font.file} as a woff2, so the locked binary is not the one that ships`,
      ).toBe(true);
      expect(normaliseRange(face)).toContain(
        `unicode-range: ${normaliseRange(font.unicodeRange)};`,
      );
      for (const [axis, range] of Object.entries(font.axes)) {
        expect(face, `${family} does not declare the ${axis} axis`).toContain(
          axis === 'wght' ? `font-weight: ${range};` : `font-stretch: ${range};`,
        );
      }
    },
  );

  it('points each src at the file the lock names, not at a path of its own', () => {
    for (const font of lock.fonts) {
      expect(fontsCss).toContain(`url('../assets/fonts/${font.file}')`);
    }
  });

  it('publishes exactly three font stacks, as custom properties', () => {
    // Three families (design language v3): Inter for everything that is read, JetBrains
    // Mono for readings, and Inter Display for the large numbers. A fourth face is a
    // decision somebody makes in a component and not in this file, so the count is asserted.
    expect(fontsCss.match(/--lupin-font-(?:sans|mono|display):/g)).toHaveLength(3);
    expect(fontsCss).toContain("--lupin-font-sans: 'Inter', 'Inter Fallback'");
    expect(fontsCss).toContain("--lupin-font-mono: 'JetBrains Mono', 'JetBrains Mono Fallback'");
    expect(fontsCss).toContain("--lupin-font-display: 'Inter Display', 'Inter'");
  });
});

describe('the display face', () => {
  it('is locked, so the hero verdict ships in a face somebody recorded', () => {
    expect(lock.fonts.map((font) => font.family)).toContain('Inter Display');
  });

  it('retires Geist: no committed binary and no stack names it', () => {
    expect(lock.fonts.map((font) => font.family)).toEqual([
      'Inter',
      'JetBrains Mono',
      'Inter Display',
    ]);
    expect(fontsCss).not.toMatch(/Geist/u);
  });

  it('is published to Tailwind as font-display', () => {
    expect(fontsCss).toContain('--font-display: var(--lupin-font-display);');
  });
});

describe('the fallback carries the measured metrics, not conventional ones', () => {
  const cases = [
    { family: 'Inter', fallback: 'Inter Fallback', local: 'Arial' },
    { family: 'JetBrains Mono', fallback: 'JetBrains Mono Fallback', local: 'Consolas' },
  ] as const;

  it.each(cases)('$family Fallback declares a local $local face', (entry) => {
    const block = fallbackFaceFor(entry.fallback);
    expect(block, `fonts.css declares no @font-face for ${entry.fallback}`).toBeDefined();
    expect(block).toContain(`src: local('${entry.local}')`);
  });

  it.each(cases)(
    '$family Fallback overrides ascent, descent and line gap from the lock',
    (entry) => {
      const metrics = lock.measuredMetrics[entry.family];
      if (!defined(metrics)) {
        throw new Error(
          `fonts-lock.json records no measured metrics for ${entry.family}, so the overrides in ` +
            `${entry.fallback} are asserted against nothing.`,
        );
      }
      const block = fallbackFaceFor(entry.fallback) ?? '';
      const percent = (units: number): string =>
        `${((units / unitsPerEm) * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
      expect(block).toContain(`ascent-override: ${percent(metrics.ascent)};`);
      expect(block).toContain(`descent-override: ${percent(Math.abs(metrics.descent))};`);
      // `0%`, and stated on both faces: Arial's own line gap is 67/2048, and
      // leaving it in is three extra pixels per line for the length of the swap.
      expect(block).toContain('line-gap-override: 0%;');
    },
  );

  it.each(cases)('$family Fallback size-adjust matches the recorded x-height ratio', (entry) => {
    const metrics = lock.measuredMetrics[entry.family];
    if (!defined(metrics)) throw new Error(`no metrics for ${entry.family}`);
    const target = metrics.xHeight / unitsPerEm;
    const fallback = metrics.fallbackXHeightPerCent / 100;
    const expected = (target / fallback) * 100;
    // Compared as a number to two places: Prettier writes `102.20%` as `102.2%`, and a
    // string comparison would fail on the formatter rather than on the measurement.
    const declared = /size-adjust:\s*([\d.]+)%;/.exec(fallbackFaceFor(entry.fallback) ?? '');
    expect(declared, `${entry.fallback} declares no size-adjust`).not.toBeNull();
    expect(Number(declared?.[1])).toBeCloseTo(expected, 2);
  });
});

describe('the stylesheet the app serves', () => {
  it('imports fonts.css, because a face nothing loads does not exist', () => {
    expect(indexCss).toMatch(/@import\s+['"][^'"]*tokens\/fonts\.css['"];/);
  });

  it('sets the body font from the custom property rather than a literal stack', () => {
    expect(indexCss).toContain('font-family: var(--lupin-font-sans);');
    expect(indexCss).toContain('font-family: var(--lupin-font-mono);');
    // A second stack written here is the failure this replaces: `index.css` used
    // to name `Inter`, which nothing loaded, so the product rendered in the OS
    // face while the stylesheet claimed otherwise.
    expect(indexCss).not.toMatch(/font-family:\s*['"]/);
  });
});

describe('the preload list', () => {
  const preloads = [...indexHtml.matchAll(/<link\b[^>]*rel="preload"[^>]*>/g)].map(
    (match) => match[0],
  );

  it('preloads exactly the locked fonts, and nothing else', () => {
    const preloaded = preloads
      .map((link) => /href="([^"]+)"/.exec(link)?.[1]?.split('/').pop() ?? '')
      .sort();
    expect(preloaded).toEqual(lock.fonts.map((font) => font.file).sort());
  });

  it('gives every preload the three attributes without which it does not work', () => {
    expect(preloads.length).toBeGreaterThan(0);
    for (const link of preloads) {
      expect(link).toMatch(/as="font"/);
      expect(link).toMatch(/type="font\/woff2"/);
      // Missing `crossorigin` means the preload goes out in CORS mode and the
      // `@font-face` request does not match it: two copies, both kept.
      expect(link).toMatch(/crossorigin/);
    }
  });

  it('references each font by a path Vite can resolve, not by a hand-written URL', () => {
    // The binaries live outside this package so the documentation site can share
    // them, which means the built URL is Vite's decision. A hand-written `/src/…`
    // would pin a URL that no longer matches the `@font-face` it warms.
    for (const link of preloads) {
      const href = /href="([^"]+)"/.exec(link)?.[1] ?? '';
      expect(href, 'a preload href is not relative, so Vite cannot fingerprint it').not.toMatch(
        /^[a-z]+:/i,
      );
      expect(href).not.toMatch(/^\//);
      expect(
        existsSync(path.join(webRoot, 'apps/web', href)),
        `apps/web/${href} does not exist, so the preload would 404`,
      ).toBe(true);
    }
  });
});

/** Narrowing helper, so the metrics cases read as one check and not four. */
function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
