/**
 * Which test a result is a result of, across runs.
 *
 * **One identity, and every consumer derives it here.** It is what `tests.stable_id`
 * holds, what flakiness and quarantine are keyed on, and what a per-test history is a
 * history of. It used to be `file › title`, restated in two places, and that collapsed
 * two kinds of distinct test into one:
 *
 * - **one test in two Playwright projects.** chromium passing and webkit failing every
 *   run read as one test that flipped every run — flaky, and a quarantine candidate —
 *   when it is a deterministic webkit failure;
 * - **one title in two `describe` blocks**, which Playwright and Jest both allow.
 *
 * The shape is `file › describe › … › title [project]`, readable on purpose: it is what an
 * operator sees in a quarantine row and pastes into a search. With no describe path and
 * no project it is the legacy `file › title` with the escaping below applied, which is
 * what the `0045` backfill writes for rows recorded before this existed — the same
 * escaping, in SQL — so a test's history does not split at the migration.
 *
 * Each segment escapes `\`, `›`, `[` and `{`, so a title cannot forge a describe boundary,
 * a project, or the repeat marker `testRowKey` appends: without it, describe `a › b` +
 * title `c` and describe `a` + title `b › c` were one test, and a title ending in
 * ` [webkit]` was the webkit project.
 *
 * **The identity is not the row key.** `--repeat-each` puts one test in one report more
 * than once; those are observations of the same test, so they share an identity, and they
 * are distinct rows of one run, so they need distinct keys. `testRowKey` is the identity
 * for the first occurrence and the identity with ` {n}` for the n-th.
 */

export interface TestIdentityInput {
  /** The spec file, repository-relative. `null` for a producer that reported none. */
  file: string | null | undefined;
  title: string;
  /** The enclosing `describe` titles, outermost first. */
  describePath?: readonly string[] | null | undefined;
  /** The Playwright project (or any runner's equivalent: a browser, a device, a shard config). */
  project?: string | null | undefined;
}

const SEPARATOR = ' › ';

/** Escapes the four characters the identity's structure is written in. */
function segment(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/›/g, '\\›')
    .replace(/\[/g, '\\[')
    .replace(/\{/g, '\\{');
}

export function testIdentity(input: TestIdentityInput): string {
  const describe = (input.describePath ?? []).filter((part) => part !== '');
  const body = [input.file ?? '', ...describe, input.title].map(segment).join(SEPARATOR);
  const project = input.project ?? '';
  return project === '' ? body : `${body} [${segment(project)}]`;
}

/**
 * The key of one occurrence of a test inside one report: the identity, then ` {n}` from the
 * second occurrence on. `occurrence` is 1-based.
 */
export function testRowKey(identity: string, occurrence: number): string {
  return occurrence <= 1 ? identity : `${identity} {${String(occurrence)}}`;
}

/**
 * The identity of a stored result: its `stableId` when it has one, and otherwise the
 * identity of its file and title — exactly what the `0045` backfill writes for a row
 * recorded before the identity existed, so the two readings of an old row agree.
 */
export function storedTestIdentity(test: {
  stableId?: string | null | undefined;
  file?: string | null | undefined;
  title: string;
}): string {
  return test.stableId === undefined || test.stableId === null || test.stableId === ''
    ? testIdentity({ file: test.file, title: test.title })
    : test.stableId;
}

/**
 * An identity read back into its parts: the inverse of {@link testIdentity}, honouring its
 * escaping, so a title containing ` › ` or ` [x]` comes back as the title it was.
 *
 * @returns `undefined` for a value that is not an identity this function wrote
 */
export function parseTestIdentity(
  identity: string,
): { file: string; describePath: string[]; title: string; project: string } | undefined {
  const segments: string[] = [];
  let current = '';
  let project: string | undefined;
  for (let index = 0; index < identity.length; index += 1) {
    const char = identity[index] ?? '';
    if (char === '\\') {
      current += identity[index + 1] ?? '';
      index += 1;
    } else if (identity.startsWith(SEPARATOR, index)) {
      segments.push(current);
      current = '';
      index += SEPARATOR.length - 1;
    } else if (char === '[' && identity.endsWith(']') && identity[index - 1] === ' ') {
      // ` [project]` closes the identity; `[` inside a segment is always escaped.
      segments.push(current.slice(0, -1));
      project = unescapeSegment(identity.slice(index + 1, -1));
      current = '';
      break;
    } else {
      current += char;
    }
  }
  if (project === undefined) segments.push(current);
  if (segments.length < 2) return undefined;
  const [file = '', ...rest] = segments;
  const title = rest.pop() ?? '';
  if (title === '') return undefined;
  return { file, describePath: rest, title, project: project ?? '' };
}

function unescapeSegment(value: string): string {
  return value.replace(/\\(.)/gu, '$1');
}

/**
 * The line Playwright's `--test-list` file wants for an identity: `[project] › file › describe
 * › title`. Playwright ignores line and column numbers and matches the title path.
 *
 * @returns `undefined` for an identity with no file, which a test list cannot name
 */
export function playwrightTestListLine(identity: string): string | undefined {
  const parts = parseTestIdentity(identity);
  if (parts === undefined || parts.file === '') return undefined;
  const path = [parts.file, ...parts.describePath, parts.title].join(SEPARATOR);
  return parts.project === '' ? path : `[${parts.project}]${SEPARATOR}${path}`;
}
