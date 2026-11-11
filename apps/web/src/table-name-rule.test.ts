import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every data table has a name (ledger MNT-191). A screen reader lists the tables on a page by
 * name, and eight `Table`s had none: the quarantine list, the score breakdown, the four gap
 * tables, the analytics table and the metric readings. A name is an `aria-label` on the
 * `Table`, or a `caption` inside it.
 */
const SRC = path.resolve(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/u.test(name) && !/\.test\.tsx$/u.test(name) ? [full] : [];
  });
}

describe('the table-name rule', () => {
  it('names every Table, by aria-label or a caption', () => {
    const offenders = files(SRC).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [...text.matchAll(/<Table\b([^>]*)>/gu)]
        .filter((match) => {
          if (/aria-label(ledby)?=/u.test(match[1] ?? '')) return false;
          const after = text.slice((match.index ?? 0) + match[0].length).trimStart();
          return !after.startsWith('<caption') && !after.startsWith('<TableCaption');
        })
        .map((match) => {
          const line = text.slice(0, match.index).split('\n').length;
          return `${path.relative(SRC, file).replaceAll('\\', '/')}:${String(line)}`;
        });
    });
    expect(offenders).toEqual([]);
  });
});
