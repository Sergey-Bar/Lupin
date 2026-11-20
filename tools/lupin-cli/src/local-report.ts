/**
 * `lupin check`: what a QA engineer wants from a test report, with no server and no account.
 *
 * Reads JUnit XML and Playwright JSON reports on disk and answers four questions: is it green,
 * which tests are flaky, what are the distinct failure causes, and what is slow. Several reports
 * (several CI runs) make flakiness visible across runs, not only within one.
 *
 * Dependency-free, like the rest of the CLI: the JUnit reader is a tolerant tag scanner, not a
 * full XML parser. It reads `testcase`, `failure`, `error`, `skipped`, and Surefire's
 * `flakyFailure`/`rerunFailure`, and decodes the five XML entities. External entities are never
 * expanded, because nothing here expands anything.
 */

export type Outcome = 'passed' | 'failed' | 'flaky' | 'skipped';

export interface TestResult {
  /** `file › suite › title`, stable across runs. */
  key: string;
  title: string;
  outcome: Outcome;
  durationMs: number | null;
  message: string | null;
}

export interface Run {
  source: string;
  tests: TestResult[];
}

export interface Cause {
  signature: string;
  example: string;
  tests: string[];
  count: number;
}

export interface Analysis {
  runs: number;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  verdict: 'green' | 'flaky' | 'red' | 'empty';
  /** Tests that failed in the newest run they appear in. */
  failing: string[];
  /** Tests that passed on a retry, or passed and failed across runs. */
  flakyTests: Array<{ key: string; evidence: string }>;
  causes: Cause[];
  slowest: Array<{ key: string; durationMs: number }>;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos);/gu, (_m, name: string) => ENTITIES[name] ?? '');
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'u').exec(tag);
  if (match === null) return null;
  return decode(match[2] ?? match[3] ?? '');
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/u)[0]?.slice(0, 300) ?? '';
}

/** JUnit XML, as Jest, pytest, Surefire, Gradle, Go and Playwright's junit reporter write it. */
export function parseJunit(xml: string): TestResult[] {
  const body = xml
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, (_m, c: string) =>
      c.replace(/&/gu, '&amp;').replace(/</gu, '&lt;'),
    );
  return [...body.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/gu)].map((match) =>
    readCase(match[1] ?? '', match[3] ?? ''),
  );
}

function readCase(open: string, inner: string): TestResult {
  const title = attr(open, 'name') ?? '(unnamed)';
  const key = [attr(open, 'file') ?? '', attr(open, 'classname') ?? '', title]
    .filter((part) => part !== '')
    .join(' › ');
  const time = Number(attr(open, 'time') ?? Number.NaN);
  return {
    key,
    title,
    durationMs: Number.isNaN(time) ? null : Math.round(time * 1000),
    ...outcomeOfCase(inner),
  };
}

function element(inner: string, names: string): { attrs: string; text: string } | null {
  const match = new RegExp(`<(${names})\\b([^>]*?)(/>|>([\\s\\S]*?)</\\1>)`, 'u').exec(inner);
  return match === null ? null : { attrs: match[2] ?? '', text: match[4] ?? '' };
}

function messageOf(found: { attrs: string; text: string }): string {
  return firstLine(attr(found.attrs, 'message') ?? decode(found.text));
}

function outcomeOfCase(inner: string): { outcome: Outcome; message: string | null } {
  const failure = element(inner, 'failure|error');
  if (failure !== null)
    return { outcome: 'failed', message: messageOf(failure) || 'failed with no message' };
  const rerun = element(inner, 'flakyFailure|flakyError|rerunFailure|rerunError');
  if (rerun !== null) return { outcome: 'flaky', message: messageOf(rerun) || null };
  return { outcome: /<skipped\b/u.test(inner) ? 'skipped' : 'passed', message: null };
}
interface PwResult {
  status?: string;
  duration?: number;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
}
interface PwTest {
  status?: string;
  projectName?: string;
  results?: PwResult[];
}
interface PwSpec {
  title?: string;
  file?: string;
  tests?: PwTest[];
}
interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

/** Playwright's JSON reporter (`--reporter=json`). Retries come from each test's `results`. */
export function parsePlaywright(json: string): TestResult[] {
  const root = JSON.parse(json) as { suites?: PwSuite[] };
  const tests: TestResult[] = [];
  const walk = (suite: PwSuite, path: string[], file: string) => {
    const titled = suite.title !== undefined && suite.title !== '' && suite.title !== file;
    const here = titled ? [...path, suite.title ?? ''] : path;
    const at = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? [])
        tests.push(readPwTest(test, spec.title ?? '(unnamed)', [at, ...here]));
    }
    for (const child of suite.suites ?? []) walk(child, here, at);
  };
  for (const suite of root.suites ?? []) walk(suite, [], suite.file ?? '');
  return tests;
}

function pwOutcome(statuses: readonly string[]): Outcome {
  const last = statuses.at(-1) ?? 'skipped';
  if (last === 'skipped') return 'skipped';
  if (last !== 'passed') return 'failed';
  return statuses.some((status) => status === 'failed' || status === 'timedOut')
    ? 'flaky'
    : 'passed';
}

function readPwTest(test: PwTest, title: string, path: string[]): TestResult {
  const results = test.results ?? [];
  const outcome = pwOutcome(results.map((result) => result.status ?? 'unknown'));
  const failing = results.find(
    (result) => result.status === 'failed' || result.status === 'timedOut',
  );
  const raw = failing?.error?.message ?? failing?.errors?.[0]?.message ?? null;
  const project =
    test.projectName !== undefined && test.projectName !== '' ? [`[${test.projectName}]`] : [];
  const fallback = outcome === 'failed' ? 'failed with no message' : null;
  return {
    key: [...path, title, ...project].filter((part) => part !== '').join(' › '),
    title,
    outcome,
    durationMs: results.reduce((sum, result) => sum + (result.duration ?? 0), 0),
    message: raw === null ? fallback : firstLine(raw.replace(ANSI, '')),
  };
}
/** Reads a report by its content: JSON is Playwright's, XML is JUnit. */
export function parseReport(source: string, text: string): Run {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return { source, tests: parsePlaywright(text) };
  if (trimmed.startsWith('<')) return { source, tests: parseJunit(text) };
  throw new Error(`${source}: not a JUnit XML or Playwright JSON report`);
}

/**
 * A failure's cause, independent of the values that differ between occurrences: numbers,
 * quoted strings, hex ids and paths are replaced, so "expected 500 to be 200" and
 * "expected 503 to be 200" are one cause.
 */
export function causeOf(message: string): string {
  return message
    .replace(/[a-z]:\\[^\s'"]{1,300}/giu, '<path>')
    .replace(/(?<![\w.])\/[^\s'"]{1,300}/gu, '<path>')
    .replace(/"[^"]{0,200}"|'[^']{0,200}'|`[^`]{0,200}`/gu, '<str>')
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/giu, '<id>')
    .replace(/\d[\d.]*/gu, '<n>')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160);
}

function flakyOf(history: ReadonlyMap<string, readonly TestResult[]>): Analysis['flakyTests'] {
  const found: Analysis['flakyTests'] = [];
  for (const [key, list] of history) {
    const retries = list.filter((test) => test.outcome === 'flaky').length;
    const passes = list.filter(
      (test) => test.outcome === 'passed' || test.outcome === 'flaky',
    ).length;
    const fails = list.filter((test) => test.outcome === 'failed').length;
    if (retries > 0) {
      found.push({
        key,
        evidence: `passed on a retry in ${String(retries)} of ${String(list.length)} run(s)`,
      });
    } else if (passes > 0 && fails > 0) {
      found.push({
        key,
        evidence: `passed ${String(passes)}, failed ${String(fails)} across runs`,
      });
    }
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

function causesOf(latest: readonly TestResult[]): Cause[] {
  const causes = new Map<string, Cause>();
  for (const test of latest.filter((item) => item.outcome === 'failed')) {
    const message = test.message ?? 'failed with no message';
    const signature = causeOf(message);
    const cause = causes.get(signature) ?? { signature, example: message, tests: [], count: 0 };
    cause.tests.push(test.key);
    cause.count += 1;
    causes.set(signature, cause);
  }
  return [...causes.values()].sort(
    (a, b) => b.count - a.count || a.signature.localeCompare(b.signature),
  );
}

function verdictOf(total: number, failed: number, flaky: boolean): Analysis['verdict'] {
  if (total === 0) return 'empty';
  if (failed > 0) return 'red';
  return flaky ? 'flaky' : 'green';
}

/** Runs are oldest first; each test is judged by its newest result. */
export function analyse(runs: readonly Run[]): Analysis {
  const history = new Map<string, TestResult[]>();
  for (const test of runs.flatMap((run) => run.tests)) {
    history.set(test.key, [...(history.get(test.key) ?? []), test]);
  }
  const latest = [...history.values()].map((list) => list[list.length - 1] as TestResult);
  const count = (outcome: Outcome) => latest.filter((test) => test.outcome === outcome).length;
  const flakyTests = flakyOf(history);
  const failed = count('failed');
  return {
    runs: runs.length,
    total: latest.length,
    passed: count('passed'),
    failed,
    flaky: count('flaky'),
    skipped: count('skipped'),
    verdict: verdictOf(latest.length, failed, flakyTests.length > 0),
    failing: latest
      .filter((test) => test.outcome === 'failed')
      .map((test) => test.key)
      .sort(),
    flakyTests,
    causes: causesOf(latest),
    slowest: latest
      .filter(
        (test): test is TestResult & { durationMs: number } =>
          test.durationMs !== null && test.outcome !== 'skipped',
      )
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 5)
      .map((test) => ({ key: test.key, durationMs: test.durationMs })),
  };
}
const VERDICT_LINE: Readonly<Record<Analysis['verdict'], string>> = {
  green: 'GREEN: every test passed.',
  flaky:
    'PASSED, BUT FLAKY: nothing failed, and some tests only passed on a retry or flip between runs.',
  red: 'RED: tests are failing.',
  empty: 'EMPTY: no test results were found in these reports.',
};

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${String(ms)}ms`;
}

function causeLines(analysis: Analysis): string[] {
  if (analysis.causes.length === 0) return [];
  const lines = [
    '',
    `${String(analysis.failed)} failure(s), ${String(analysis.causes.length)} distinct cause(s) - fix these, biggest first:`,
  ];
  for (const cause of analysis.causes.slice(0, 10)) {
    lines.push(
      `  ${String(cause.count)} x ${cause.example}`,
      ...cause.tests.slice(0, 3).map((key) => `      ${key}`),
    );
    if (cause.tests.length > 3) lines.push(`      and ${String(cause.tests.length - 3)} more`);
  }
  return lines;
}

function flakyLines(analysis: Analysis): string[] {
  if (analysis.flakyTests.length === 0) return [];
  return [
    '',
    `Flaky tests (${String(analysis.flakyTests.length)}) - fix or quarantine, do not just re-run:`,
    ...analysis.flakyTests.slice(0, 15).map((test) => `  ${test.key} - ${test.evidence}`),
  ];
}

function slowLines(analysis: Analysis): string[] {
  if (analysis.slowest.length === 0) return [];
  return [
    '',
    'Slowest tests:',
    ...analysis.slowest.map((test) => `  ${seconds(test.durationMs)}  ${test.key}`),
  ];
}

export function renderText(analysis: Analysis): string {
  return [
    VERDICT_LINE[analysis.verdict],
    `${String(analysis.total)} tests over ${String(analysis.runs)} report(s): ${String(analysis.passed)} passed, ` +
      `${String(analysis.failed)} failed, ${String(analysis.flaky)} flaky, ${String(analysis.skipped)} skipped.`,
    ...causeLines(analysis),
    ...flakyLines(analysis),
    ...slowLines(analysis),
    ...(analysis.runs === 1
      ? ['', 'Tip: pass the reports of several CI runs to see tests that flip between runs.']
      : []),
  ].join('\n');
}
function escape(text: string): string {
  return text.replace(/[&<>"']/gu, (c) => `&#${String(c.charCodeAt(0))};`);
}

/** One self-contained HTML page, for a CI artifact. Fetches nothing. */
export function renderHtml(analysis: Analysis): string {
  const colour = { green: '#1a7f37', flaky: '#9a6700', red: '#cf222e', empty: '#57606a' }[
    analysis.verdict
  ];
  const list = (items: string[]) =>
    items.length === 0 ? '<p>None.</p>' : `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test report - ${analysis.verdict}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1f2328}
h1{color:${colour}}code{font-size:13px}li{margin:.25rem 0}</style></head><body>
<h1>${escape(VERDICT_LINE[analysis.verdict])}</h1>
<p>${String(analysis.total)} tests over ${String(analysis.runs)} report(s): ${String(analysis.passed)} passed, ${String(analysis.failed)} failed, ${String(analysis.flaky)} flaky, ${String(analysis.skipped)} skipped.</p>
<h2>Failure causes</h2>${list(analysis.causes.map((c) => `<strong>${String(c.count)} x</strong> <code>${escape(c.example)}</code><br><small>${c.tests.slice(0, 5).map(escape).join('<br>')}</small>`))}
<h2>Flaky tests</h2>${list(analysis.flakyTests.map((t) => `<code>${escape(t.key)}</code> - ${escape(t.evidence)}`))}
<h2>Slowest tests</h2>${list(analysis.slowest.map((t) => `${seconds(t.durationMs)} <code>${escape(t.key)}</code>`))}
<p><small>Generated by <code>lupin check</code>.</small></p></body></html>
`;
}
