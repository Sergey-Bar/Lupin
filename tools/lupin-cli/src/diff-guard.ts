/**
 * `lupin diff-guard`'s reading of a diff: the changes that weaken the tests judging it.
 *
 * Pure: a `git diff` in, findings out. The point of running it in CI rather than on the server
 * is that **no line of source leaves the job** — a finding is a kind, a path, a line number and
 * which side of the diff the line is on, and `diff-guard.test.ts` fails if any text of a line
 * reaches the report.
 *
 * Every rule is chosen to be quiet on ordinary work, because a guard that cries wolf is
 * switched off:
 *
 * - patterns are matched on code with its strings and comments removed, so `"it.skip("` in a
 *   string or a commented-out `xit(` is not a skip;
 * - a line that only moved — removed and added again, identical — cancels out;
 * - a loose assertion is "loosened" only when the same hunk removed a strict one;
 * - a threshold or a retry count is compared key by key within a hunk, so raising one is not
 *   lowering another;
 * - snapshot updates count only in bulk, since updating one snapshot is the normal case.
 *
 * **One list, held twice on purpose, and tested to agree.** The CLI ships with no dependency,
 * so it cannot import `TEST_TAMPER_KINDS` from `@lupin/shared-contracts`; `units.test.ts`
 * fails if the two ever differ.
 */

export const DIFF_GUARD_VERSION = 'diff-guard/1';

export const TAMPER_KINDS = [
  'test-deleted',
  'skip-added',
  'assertion-removed',
  'assertion-loosened',
  'empty-catch',
  'snapshot-bulk-update',
  'threshold-lowered',
  'ci-made-non-failing',
  'retry-added',
] as const;
export type TamperKind = (typeof TAMPER_KINDS)[number];

/** Findings kept in the report. Every finding is still counted. */
export const MAX_FINDINGS = 200;
/** Snapshot files updated in one change before it counts as a bulk update. */
export const SNAPSHOT_BULK_FILES = 5;
/** Or snapshot lines changed. */
export const SNAPSHOT_BULK_LINES = 200;
const MAX_PATH = 500;

export interface GuardFinding {
  kind: TamperKind;
  path: string;
  /** The line on its side of the diff; `null` for a finding about a whole file. */
  line: number | null;
  /** `base` is the line before the change (a removal), `head` after it (an addition). */
  side: 'base' | 'head';
}

export interface GuardReport {
  version: string;
  /** At most {@link MAX_FINDINGS}, in file order. */
  findings: GuardFinding[];
  /** Every finding, by kind, including the ones past the limit. */
  counts: Partial<Record<TamperKind, number>>;
  filesChecked: number;
  /** Findings were cut at the limit, or the diff itself was cut short by the reader. */
  truncated: boolean;
}

interface DiffLine {
  line: number;
  text: string;
}

interface Hunk {
  added: DiffLine[];
  removed: DiffLine[];
}

interface FileDiff {
  oldPath: string | null;
  newPath: string | null;
  deleted: boolean;
  hunks: Hunk[];
}

// ─── Reading the diff ─────────────────────────────────────────────────────────

// `\S*` rather than `(?:,\d+)?`: the counts are not read, and a nested quantifier is the shape
// `security/detect-unsafe-regex` refuses.
const HUNK = /^@@ -(\d+)\S* \+(\d+)\S* @@/u;

const stripPrefix = (path: string, prefix: string) =>
  path.startsWith(prefix) ? path.slice(prefix.length) : path;

/** A path from a `---` or `+++` line: `null` for `/dev/null`, else without git's `a/` or `b/`. */
const headerPath = (raw: string, prefix: string) => {
  const path = raw.slice(4);
  return path === '/dev/null' ? null : stripPrefix(path, prefix);
};

/** One line of a file's header: what happened to the file, and its paths as git wrote them. */
function readHeader(file: FileDiff, raw: string): void {
  if (raw.startsWith('deleted file mode')) file.deleted = true;
  else if (raw.startsWith('rename from ')) file.oldPath = raw.slice('rename from '.length);
  else if (raw.startsWith('rename to ')) file.newPath = raw.slice('rename to '.length);
  else if (raw.startsWith('--- ')) file.oldPath = headerPath(raw, 'a/');
  else if (raw.startsWith('+++ ')) file.newPath = headerPath(raw, 'b/');
}

/** Where the parser is: the hunk it is in, and the next line number on each side. */
interface Cursor {
  hunk: Hunk;
  oldLine: number;
  newLine: number;
}

/** One line inside a hunk: an addition, a removal, or context that moves both sides on. */
function readHunkLine(cursor: Cursor, raw: string): void {
  if (raw.startsWith('+')) {
    cursor.hunk.added.push({ line: cursor.newLine, text: raw.slice(1) });
    cursor.newLine += 1;
  } else if (raw.startsWith('-')) {
    cursor.hunk.removed.push({ line: cursor.oldLine, text: raw.slice(1) });
    cursor.oldLine += 1;
  } else if (raw.startsWith(' ')) {
    cursor.oldLine += 1;
    cursor.newLine += 1;
  }
}

function startFile(raw: string): FileDiff {
  const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(raw);
  return { oldPath: match?.[1] ?? null, newPath: match?.[2] ?? null, deleted: false, hunks: [] };
}

/** The files of a unified diff, each with its hunks' added and removed lines numbered. */
function parse(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let cursor: Cursor | null = null;
  for (const raw of text.split(/\r?\n/u)) {
    if (raw.startsWith('diff --git ')) {
      file = startFile(raw);
      files.push(file);
      cursor = null;
      continue;
    }
    if (file === null) continue;
    const header = HUNK.exec(raw);
    if (header !== null) {
      cursor = {
        hunk: { added: [], removed: [] },
        oldLine: Number(header[1]),
        newLine: Number(header[2]),
      };
      file.hunks.push(cursor.hunk);
    } else if (cursor === null) {
      readHeader(file, raw);
    } else {
      readHunkLine(cursor, raw);
    }
  }
  return files;
}

// ─── Which files are which ────────────────────────────────────────────────────

const TEST_DIRECTORIES = new Set(['__tests__', 'test', 'tests', 'spec', 'specs', 'e2e']);

function segmentsOf(path: string): { directories: string[]; base: string } {
  const parts = path.replace(/\\/gu, '/').split('/');
  return { directories: parts.slice(0, -1), base: parts[parts.length - 1] as string };
}

export function isTestPath(path: string): boolean {
  const { directories, base } = segmentsOf(path);
  return (
    /\.(?:test|spec|cy)\.[cm]?[jt]sx?$/u.test(base) ||
    /_test\.(?:go|py)$/u.test(base) ||
    /^test_[\w-]*\.py$/u.test(base) ||
    base === 'conftest.py' ||
    /(?:Test|Tests|IT)\.(?:java|kt|cs|scala)$/u.test(base) ||
    directories.some((directory) => TEST_DIRECTORIES.has(directory))
  );
}

const isSnapshot = (path: string) => path.endsWith('.snap') || path.includes('__snapshots__/');

function isCiPath(path: string): boolean {
  const lower = path.toLowerCase();
  const { base } = segmentsOf(lower);
  return (
    /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(lower) ||
    /^\.github\/actions\/.+\/action\.ya?ml$/u.test(lower) ||
    lower.startsWith('.circleci/') ||
    [
      '.gitlab-ci.yml',
      'jenkinsfile',
      'azure-pipelines.yml',
      'bitbucket-pipelines.yml',
      '.travis.yml',
    ].includes(base)
  );
}

const CONFIG_BASES = new Set([
  'codecov.yml',
  '.codecov.yml',
  'pytest.ini',
  '.coveragerc',
  'setup.cfg',
  'tox.ini',
  'pyproject.toml',
  'package.json',
]);

function isTestConfigPath(path: string): boolean {
  const lower = path.toLowerCase();
  const { base } = segmentsOf(lower);
  return (
    CONFIG_BASES.has(base) ||
    base.startsWith('.nycrc') ||
    base.startsWith('.c8rc') ||
    /^(?:vitest|jest|playwright|cypress|karma|stryker)\.config\./u.test(base) ||
    lower.includes('coverage')
  );
}

// ─── Reading a line ───────────────────────────────────────────────────────────

/** The line with its strings emptied and its comments removed: what the code itself says. */
function codeOf(text: string, python: boolean): string {
  const withoutStrings = text
    .replace(/\/\*.*?\*\//gu, ' ')
    .replace(
      /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/gu,
      (quoted) => `${quoted[0]}${quoted[0]}`,
    );
  const slash = withoutStrings.indexOf('//');
  const code = slash === -1 ? withoutStrings : withoutStrings.slice(0, slash);
  if (!python) return code;
  const hash = code.indexOf('#');
  return hash === -1 ? code : code.slice(0, hash);
}

/** A YAML or shell line without its comment. */
const withoutHashComment = (text: string) => text.replace(/(?:^|\s)#.*$/u, '');

const SKIP = [
  /\b(?:it|test|describe|context|suite|specify)\.(?:skip|only|todo|fixme)\s*\(/u,
  /(?<![\w.$])(?:xit|xtest|xdescribe|xcontext|fit|fdescribe|ftest)\s*\(/u,
  /@(?:Disabled|Ignore)\b/u,
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/u,
  /\bpytest\.skip\s*\(/u,
  /@unittest\.skip/u,
  /\bt\.Skip(?:f|Now)?\s*\(/u,
];
const ASSERTION =
  /\bexpect\s*\(|\bassert(?:\.\w+|\w*)\s*\(|^\s*assert\s+\S|\.should\b|\bt\.(?:Error|Errorf|Fatal|Fatalf)\s*\(|\brequire\.\w+\s*\(/gu;
const STRICT =
  /\.(?:not\.)?(?:toBe|toEqual|toStrictEqual|toMatch\w*|toHaveLength|toContain\w*|toHaveBeenCalledWith|toHaveProperty|toThrow\w*)\s*\(\s*[^)\s]|\bassert(?:Equals?|That|\.(?:equal|deepEqual|strictEqual|deepStrictEqual))\s*\(/u;
const LOOSE = [
  /\.(?:toBeDefined|toBeTruthy|toBeFalsy)\s*\(\s*\)/u,
  /\bexpect\.any(?:thing)?\s*\(/u,
  /\bassertTrue\s*\(\s*(?:true|True)\s*\)/u,
  /^\s*assert\s+True\b/u,
  /\bassert\.ok\s*\(/u,
];
const EMPTY_CATCH = [
  /\bcatch\s*\{\s*\}/u,
  /\bcatch\s*\([^)]*\)\s*\{\s*\}/u,
  /\.catch\s*\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*(?:\{\s*\}|undefined|null)\s*\)/u,
  /^\s*except\b[^:]*:\s*pass\b/u,
];
const CI_NON_FAILING = [
  /\bcontinue-on-error\s*:\s*true\b/u,
  /\ballow_failure\s*:\s*true\b/u,
  /\|\|\s*true\b/u,
  /\|\|\s*exit\s+0\b/u,
  /\bset\s+\+e\b/u,
  /^\s*if\s*:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/u,
];
const CI_CHECK_STEP =
  /^\s*-?\s*run\s*:.*\b(?:test|tests|lint|check|verify|coverage|e2e|playwright|vitest|jest|pytest|gate|scan|audit|typecheck)\b/iu;
const THRESHOLD =
  /["']?\b(statements|branches|functions|lines|thresholds?|fail_under|fail-under|minimum|break)\b["']?\s*[:=]\s*["']?(\d[\d.]*)/gu;
const RETRY_COUNT =
  /\b(retries|retryTimes|reruns|rerunFailingTestsCount|retry)\b["']?\s*[:=(]\s*["']?(\d+)|--(retries|reruns)[= ](\d+)/gu;
const RETRY_MARKER = [/@pytest\.mark\.flaky\b/u, /@(?:Retry|RepeatedTest|Flaky)\b/u];

const anyOf = (patterns: readonly RegExp[]) => (text: string) =>
  patterns.some((pattern) => pattern.test(text));
const count = (pattern: RegExp, text: string) => [...text.matchAll(pattern)].length;

// ─── The rules ────────────────────────────────────────────────────────────────

/**
 * The lines on one side that match, after cancelling every identical line on the other side —
 * so a line that only moved is not news.
 */
function unmatched(
  mine: readonly DiffLine[],
  theirs: readonly DiffLine[],
  hit: (text: string) => boolean,
): DiffLine[] {
  const other = new Map<string, number>();
  for (const line of theirs) {
    const key = line.text.trim();
    other.set(key, (other.get(key) ?? 0) + 1);
  }
  const left: DiffLine[] = [];
  for (const line of mine) {
    const key = line.text.trim();
    const pending = other.get(key) ?? 0;
    if (pending > 0) {
      other.set(key, pending - 1);
      continue;
    }
    if (hit(line.text)) left.push(line);
  }
  return left;
}

/** Added lines that match, net of removed lines that match, after cancelling moves. */
function netAdded(file: FileDiff, hit: (text: string) => boolean): DiffLine[] {
  const added = file.hunks.flatMap((hunk) => hunk.added);
  const removed = file.hunks.flatMap((hunk) => hunk.removed);
  const gained = unmatched(added, removed, hit);
  const lost = unmatched(removed, added, hit);
  return gained.slice(0, Math.max(0, gained.length - lost.length));
}

/** Removed lines that match, net of added lines that match, after cancelling moves. */
function netRemoved(
  file: FileDiff,
  hit: (text: string) => boolean,
  weight = (_text: string) => 1,
): DiffLine[] {
  const added = file.hunks.flatMap((hunk) => hunk.added);
  const removed = file.hunks.flatMap((hunk) => hunk.removed);
  const lost = unmatched(removed, added, hit);
  const gained = unmatched(added, removed, hit);
  const net =
    lost.reduce((sum, line) => sum + weight(line.text), 0) -
    gained.reduce((sum, line) => sum + weight(line.text), 0);
  return lost.slice(0, Math.max(0, Math.min(lost.length, net)));
}

/** Per hunk, each numeric key whose added value moved the wrong way from its removed value. */
function numericMoves(
  hunk: Hunk,
  pattern: RegExp,
  worse: (before: number, after: number) => boolean,
  absentBefore: number | null,
): DiffLine[] {
  const values = (lines: readonly DiffLine[]) => {
    const found = new Map<string, { value: number; line: DiffLine }>();
    for (const line of lines) {
      for (const match of withoutHashComment(line.text).matchAll(pattern)) {
        const key = (match[1] ?? match[3] ?? '').toLowerCase();
        const value = Number(match[2] ?? match[4]);
        if (key !== '' && Number.isFinite(value) && !found.has(key))
          found.set(key, { value, line });
      }
    }
    return found;
  };
  const before = values(hunk.removed);
  const after = values(hunk.added);
  const moved: DiffLine[] = [];
  for (const [key, entry] of after) {
    const previous = before.get(key)?.value ?? absentBefore;
    if (previous !== null && worse(previous, entry.value)) moved.push(entry.line);
  }
  return moved;
}

const finding = (
  kind: TamperKind,
  path: string,
  line: DiffLine | null,
  side: GuardFinding['side'],
): GuardFinding => ({
  kind,
  path: path.slice(0, MAX_PATH),
  line: line?.line ?? null,
  side,
});

function testCodeFindings(file: FileDiff, path: string): GuardFinding[] {
  const python = path.endsWith('.py');
  const code = (text: string) => codeOf(text, python);
  const findings = [
    ...netAdded(file, (text) => anyOf(SKIP)(code(text))).map((line) =>
      finding('skip-added', path, line, 'head'),
    ),
    ...netRemoved(
      file,
      (text) => count(ASSERTION, code(text)) > 0,
      (text) => count(ASSERTION, code(text)),
    ).map((line) => finding('assertion-removed', path, line, 'base')),
  ];
  for (const hunk of file.hunks) {
    const strict = unmatched(hunk.removed, hunk.added, (text) => STRICT.test(code(text))).length;
    const loose = unmatched(hunk.added, hunk.removed, (text) => anyOf(LOOSE)(code(text)));
    findings.push(
      ...loose.slice(0, strict).map((line) => finding('assertion-loosened', path, line, 'head')),
    );
  }
  findings.push(
    ...netAdded(file, (text) => anyOf(EMPTY_CATCH)(code(text))).map((line) =>
      finding('empty-catch', path, line, 'head'),
    ),
  );
  return findings;
}

function retryFindings(file: FileDiff, path: string): GuardFinding[] {
  const lines = new Map<number, DiffLine>();
  for (const hunk of file.hunks) {
    for (const line of numericMoves(hunk, RETRY_COUNT, (before, after) => after > before, 0))
      lines.set(line.line, line);
  }
  for (const line of netAdded(file, anyOf(RETRY_MARKER))) lines.set(line.line, line);
  return [...lines.values()]
    .sort((a, b) => a.line - b.line)
    .map((line) => finding('retry-added', path, line, 'head'));
}

function fileFindings(file: FileDiff): GuardFinding[] {
  const path = file.newPath ?? file.oldPath ?? '';
  const oldPath = file.oldPath;
  // A test that is gone, or renamed out of the test tree, no longer runs.
  const gone = file.deleted || (file.newPath !== null && !isTestPath(file.newPath));
  if (oldPath !== null && isTestPath(oldPath) && !isSnapshot(oldPath) && gone) {
    return [finding('test-deleted', oldPath, null, 'base')];
  }
  if (file.deleted || isSnapshot(path)) return [];
  const findings: GuardFinding[] = [];
  if (isTestPath(path)) findings.push(...testCodeFindings(file, path));
  if (isTestConfigPath(path)) {
    for (const hunk of file.hunks) {
      findings.push(
        ...numericMoves(hunk, THRESHOLD, (before, after) => after < before, null).map((line) =>
          finding('threshold-lowered', path, line, 'head'),
        ),
      );
    }
  }
  if (isCiPath(path)) {
    findings.push(
      ...netAdded(file, (text) => anyOf(CI_NON_FAILING)(withoutHashComment(text))).map((line) =>
        finding('ci-made-non-failing', path, line, 'head'),
      ),
      ...netRemoved(file, (text) => CI_CHECK_STEP.test(withoutHashComment(text))).map((line) =>
        finding('ci-made-non-failing', path, line, 'base'),
      ),
    );
  }
  if (isTestPath(path) || isTestConfigPath(path) || isCiPath(path))
    findings.push(...retryFindings(file, path));
  return findings;
}

/** One finding per updated snapshot file, but only when the update is a bulk one. */
function snapshotFindings(files: readonly FileDiff[]): GuardFinding[] {
  const updated = files.filter(
    (file) =>
      !file.deleted && file.oldPath !== null && file.newPath !== null && isSnapshot(file.newPath),
  );
  const lines = updated.reduce(
    (sum, file) =>
      sum + file.hunks.reduce((total, hunk) => total + hunk.added.length + hunk.removed.length, 0),
    0,
  );
  if (updated.length < SNAPSHOT_BULK_FILES && lines < SNAPSHOT_BULK_LINES) return [];
  return updated.map((file) => finding('snapshot-bulk-update', file.newPath ?? '', null, 'head'));
}

export function analyzeDiff(text: string, options: { inputTruncated?: boolean } = {}): GuardReport {
  const files = parse(text);
  const all = [...files.flatMap(fileFindings), ...snapshotFindings(files)];
  const counts: Partial<Record<TamperKind, number>> = {};
  for (const entry of all) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  return {
    version: DIFF_GUARD_VERSION,
    findings: all.slice(0, MAX_FINDINGS),
    counts,
    filesChecked: files.length,
    truncated: all.length > MAX_FINDINGS || options.inputTruncated === true,
  };
}
