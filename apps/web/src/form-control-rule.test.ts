import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One set of form controls (ledger MNT-189). A field is `Input`, `Textarea`, `Select` or
 * `Checkbox` from `@lupin/ui`, never a hand-styled `<input>`, `<textarea>` or `<select>`: the
 * quarantine form, the launch form, the runner and toolbox filters, the copilot follow-up, the
 * GitHub App key and two checkboxes each drew their own height, border and focus ring.
 */
const SRC = path.resolve(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/u.test(name) && !/\.test\.tsx$/u.test(name) ? [full] : [];
  });
}

describe('the form-control rule', () => {
  it('draws no raw input, textarea or select: a field comes from @lupin/ui', () => {
    const offenders = files(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/<(input|textarea|select)\b/gu)].map(
        (match) => `${path.relative(SRC, file).replaceAll('\\', '/')}: <${match[1] ?? ''}>`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
