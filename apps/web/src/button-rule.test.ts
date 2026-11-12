import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One button system. A solid fill is `Button` or `ButtonLink` (both `buttonVariants` in
 * `@lupin/ui`), never a hand-written `bg-primary … text-on-fill` string on a link: those
 * drifted in height, radius and hover from the real button, which is why the screens read as
 * mixed. The one-primary-per-screen half of the rule is `expectOnePrimary` in the page tests.
 */
const SRC = path.resolve(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/u.test(name) && !/\.test\.tsx$/u.test(name) ? [full] : [];
  });
}

describe('the button rule', () => {
  it('draws no hand-styled solid button: a fill comes from buttonVariants', () => {
    const offenders = files(SRC).filter((file) =>
      (readFileSync(file, 'utf8').match(/(['"`])[^'"`]*\1/gu) ?? []).some(
        (literal) =>
          /\bbg-primary(-gradient)?(?![\w-])/u.test(literal) &&
          /\btext-on-(fill|primary)\b/u.test(literal),
      ),
    );
    expect(offenders.map((file) => path.relative(SRC, file).replaceAll('\\', '/'))).toEqual([]);
  });
});
