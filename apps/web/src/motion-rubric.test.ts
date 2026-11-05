import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The flat, calm rubric, as the three checks that a reading of the source can decide.
 *
 * Each is a rule `site/guide/design-language.md` already states and nothing enforced:
 *
 * - **Depth comes from the elevation stack.** A shadow is one of the three layered neutral
 *   `shadow-elevation-*` steps, never Tailwind's single-layer `shadow-md` or `shadow-lg`, which
 *   is a smudge on the light plane and a second shadow vocabulary on the dark one.
 * - **Hover and colour are 100 ms.** A colour that takes longer to follow the pointer reads
 *   as lag, not as calm.
 * - **A duration is real.** `duration-*` sets `transition-duration` and nothing else, so beside
 *   an `animate-*` with no transition it changes nothing and claims a timing that is not the one
 *   on screen. The animation's time comes from its token.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [here, path.resolve(here, '../../../packages/ui/src/components')];

function sources(directory: string): Array<{ name: string; body: string }> {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sources(full);
    if (!entry.endsWith('.tsx') || entry.includes('.test.') || entry.includes('.stories.')) {
      return [];
    }
    return [
      {
        name: path.relative(path.resolve(here, '../../..'), full),
        body: readFileSync(full, 'utf8'),
      },
    ];
  });
}

/** Every quoted or template string in a source file, which is where class lists live. */
function classStrings(body: string): string[] {
  return [...body.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
}

const files = ROOTS.flatMap(sources);

describe('the flat, calm rubric', () => {
  it('reads the component trees', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('draws every shadow from the elevation stack', () => {
    const offenders = files.flatMap(({ name, body }) =>
      [...body.matchAll(/(?<![\w-])shadow-(?:xs|sm|md|lg|xl|2xl)\b/g)].map(
        (match) => `${name}: ${match[0]}`,
      ),
    );
    expect(offenders, 'use shadow-elevation-1, -2 or -3').toEqual([]);
  });

  it('follows the pointer with colour in 100ms or less', () => {
    const offenders = files.flatMap(({ name, body }) =>
      classStrings(body)
        .filter((value) => /\btransition-colors\b/.test(value))
        .flatMap((value) => {
          const ms = Number(/(?<![\w-])duration-(\d+)\b/.exec(value)?.[1] ?? 0);
          return ms > 100 ? [`${name}: transition-colors duration-${String(ms)}`] : [];
        }),
    );
    expect(offenders).toEqual([]);
  });

  it('never writes a duration that only an absent transition would read', () => {
    const offenders = files.flatMap(({ name, body }) =>
      classStrings(body)
        .filter(
          (value) =>
            /(?<![\w-])animate-[\w-]+/.test(value) &&
            /(?<![\w-])duration-\d+\b/.test(value) &&
            !/(?<![\w-])transition\b/.test(value),
        )
        .map((value) => `${name}: ${/(?<![\w-])duration-\d+/.exec(value)?.[0] ?? ''}`),
    );
    expect(offenders, 'the animation takes its time from its token').toEqual([]);
  });
});

/**
 * Typography the base layer owns, so no heading has to remember it.
 *
 * Fourteen headings in the product were written without `text-balance`, so a two-line title
 * broke with one word alone on its second line. And a figure in a heading or a table cell
 * jittered sideways as it counted, because proportional digits are different widths.
 */
describe('the base typography', () => {
  const entry = readFileSync(path.join(here, 'index.css'), 'utf8');
  const rule = (selector: RegExp): string =>
    new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(entry)?.[1] ?? '';

  it('balances every heading', () => {
    expect(rule(/h1,\s*h2,\s*h3,\s*h4/)).toMatch(/text-wrap:\s*balance/);
  });

  it('sets table figures in tabular numerals', () => {
    expect(rule(/td,\s*th/)).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});
