import { optional, parseOptions } from './args.js';
import type { Io } from './commands.js';
import { baseOf, gitWith, type Git } from './diff-guard-command.js';
import { EXIT, usage, type ExitCode } from './errors.js';
import { selectTests, type ImpactReport } from './impact.js';

/**
 * `lupin impact [--base <ref>] [--format text|paths|json]`
 *
 * Which tests to run first for the change on this branch: the tests it touched, and the tests
 * named after the source files it touched. Reads `git diff --name-only <base>...HEAD` and
 * `git ls-files` here and sends nothing anywhere, so it needs no Lupin install and no token.
 *
 * `--format paths` prints one test file per line, ready for a test runner; when the change
 * touched what every test depends on, it prints every test file instead, because a selection
 * it cannot trust is not one to run.
 */

/** Names only: a file list, not a diff, is all this reads. */
const runGit: Git = gitWith({ limit: 16 * 1024 * 1024 });
const FORMATS = ['text', 'paths', 'json'] as const;
type Format = (typeof FORMATS)[number];

const lines = (output: string) =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

function printText(io: Io, report: ImpactReport): void {
  if (report.runAll !== null) {
    io.out(`impact: run every test: ${report.runAll}.`);
    return;
  }
  io.out(
    `impact: ${String(report.tests.length)} test file(s) for ${String(report.changedFiles)} changed file(s), selected by name:`,
  );
  for (const test of report.tests) {
    io.out(`  - ${test.path} (${test.source === null ? 'changed' : `named after ${test.source}`})`);
  }
  if (report.untested.length > 0) {
    io.out(
      `impact: ${String(report.untested.length)} changed source file(s) no test is named after:`,
    );
    for (const path of report.untested) io.out(`  - ${path}`);
  }
}

export async function impact(argv: readonly string[], io: Io & { git?: Git }): Promise<ExitCode> {
  const parsed = parseOptions(argv, { values: ['base', 'format'] });
  const base = baseOf(io, optional(parsed, 'base'));
  const format = (optional(parsed, 'format') ?? 'text') as Format;
  if (!FORMATS.includes(format)) throw usage('--format is text, paths or json');
  const git = io.git ?? runGit;
  const [diff, files] = await Promise.all([
    git(['diff', '--name-only', '--no-renames', `${base}...HEAD`], io.cwd),
    git(['ls-files'], io.cwd),
  ]);
  if (diff.code !== 0 || files.code !== 0) {
    throw usage(
      `git could not compare with ${base}. Is it fetched? On GitHub Actions, check out with fetch-depth: 0.`,
    );
  }
  const tracked = lines(files.stdout);
  const report = selectTests(lines(diff.stdout), tracked);
  if (format === 'json') io.out(JSON.stringify(report));
  else if (format === 'text') printText(io, report);
  else if (report.runAll !== null) {
    for (const path of selectTests(tracked, tracked).tests) io.out(path.path);
  } else {
    for (const test of report.tests) io.out(test.path);
  }
  return EXIT.ok;
}
