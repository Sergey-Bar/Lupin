/**
 * The `view-transition-name` a run carries in a list and on its detail page.
 *
 * Two elements morph across a navigation only when they share a name, so the run's label in
 * the list and its heading on the detail page both ask for this one. A CSS identifier may
 * not start with a digit and may not contain most punctuation, so the id is prefixed and
 * every character outside `[A-Za-z0-9_-]` is written as `_<hex code point>` — an escape
 * rather than a replacement, so `a/b` and `a:b` stay two different names.
 */
export function runTransitionName(runId: string): string {
  const escaped = [...runId]
    .map((character) =>
      /[A-Za-z0-9-]/.test(character)
        ? character
        : `_${(character.codePointAt(0) ?? 0).toString(16)}`,
    )
    .join('');
  return `run-${escaped}`;
}
