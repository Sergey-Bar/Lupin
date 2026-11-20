import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { optional, parseOptions } from './args.js';
import type { Io } from './commands.js';
import { CliError, EXIT, usage } from './errors.js';
import { analyse, parseReport, renderHtml, renderText, type Run } from './local-report.js';

/**
 * `lupin check [--html <out>] [--json] [--fail-on-flaky] -- <report…>`
 *
 * No server, no token: reads JUnit XML or Playwright JSON reports and prints the verdict, the
 * distinct failure causes, the flaky tests and the slowest ones. Pass the reports of several
 * runs, oldest first, to see tests that flip between runs. Exits 1 when a test fails, or with
 * `--fail-on-flaky` when one is flaky; 2 when a report cannot be read.
 */
export async function check(argv: readonly string[], io: Io): Promise<number> {
  const split = argv.indexOf('--');
  const parsed = parseOptions(split === -1 ? argv : argv.slice(0, split), {
    values: ['html'],
    switches: ['json', 'fail-on-flaky'],
  });
  const files = split === -1 ? [] : argv.slice(split + 1);
  if (files.length === 0) throw usage('Name at least one report: lupin check -- junit.xml');
  const runs = await readRuns(files, io.cwd);
  const analysis = analyse(runs);
  io.out(parsed.switches.has('json') ? JSON.stringify(analysis, null, 2) : renderText(analysis));
  const html = optional(parsed, 'html');
  if (html !== undefined) {
    await writeFile(path.resolve(io.cwd, html), renderHtml(analysis), 'utf8');
    if (!parsed.switches.has('json')) io.out(`\nWrote ${html}`);
  }
  if (analysis.verdict === 'empty' || analysis.verdict === 'red') return EXIT.gateFailed;
  if (analysis.verdict === 'flaky' && parsed.switches.has('fail-on-flaky')) return EXIT.gateFailed;
  return EXIT.ok;
}

async function readRuns(files: readonly string[], cwd: string): Promise<Run[]> {
  const runs: Run[] = [];
  for (const file of files) {
    const text = await readFile(path.resolve(cwd, file), 'utf8').catch(() => {
      throw new CliError(`Cannot read ${file}`, EXIT.usage);
    });
    try {
      runs.push(parseReport(file, text));
    } catch (error) {
      throw new CliError(error instanceof Error ? error.message : String(error), EXIT.usage);
    }
  }
  return runs;
}
