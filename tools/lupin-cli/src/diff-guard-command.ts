import { spawn } from 'node:child_process';
import { optional, parseOptions } from './args.js';
import { branchOf, commitOf, pullRequestOf, target, type Io } from './commands.js';
import { analyzeDiff, type GuardReport, type TamperKind } from './diff-guard.js';
import { EXIT, usage, type ExitCode } from './errors.js';
import { send } from './http.js';
import { projectUrl } from './target.js';

/**
 * `lupin diff-guard [--base <ref>] [--branch --commit --pr] [--dry-run] [--fail-on-findings]`
 *
 * Reads `git diff <base>...HEAD` in the job and reports the changes that weaken the tests:
 * deleted tests, added skips, removed or loosened assertions, empty catches, bulk snapshot
 * updates, lowered thresholds, CI steps that can no longer fail, added retries.
 *
 * **What leaves the job:** kinds, paths and line numbers — never the text of a line, so the
 * guard is safe to run on code that may not be sent anywhere. `--dry-run` prints the findings
 * and sends nothing, which needs no Lupin install at all.
 *
 * It reports; it does not judge. The gate reads the findings as one factor of a change's
 * risk, and the job's exit code is 0 unless `--fail-on-findings` asks otherwise.
 */

/** The diff read before the guard stops and says the rest was not read. */
export const MAX_DIFF_BYTES = 64 * 1024 * 1024;
const LISTED = 10;

export interface GitResult {
  code: number;
  stdout: string;
  /** The output was cut at {@link MAX_DIFF_BYTES}. */
  truncated: boolean;
}

export type Git = (args: readonly string[], cwd: string) => Promise<GitResult>;

/** `git` with its output capped at `limit`, never through a shell. */
export function gitWith(options: { limit: number; command?: string }): Git {
  const { limit, command = 'git' } = options;
  return (args, cwd) =>
    new Promise((resolve) => {
      const child = spawn(command, [...args], {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      child.stdout.on('data', (chunk: Buffer) => {
        if (truncated) return;
        if (size + chunk.length > limit) {
          chunks.push(chunk.subarray(0, limit - size));
          truncated = true;
          child.kill();
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      // A failed spawn emits `error` and may then emit `close`; a promise settles once.
      const finish = (code: number) => {
        // Killed at the cap is a diff that was read in part, not a git failure.
        resolve({
          code: truncated ? 0 : code,
          stdout: Buffer.concat(chunks).toString('utf8'),
          truncated,
        });
      };
      child.on('error', () => finish(127));
      child.on('close', (code) => finish(code ?? 1));
    });
}

export const runGit: Git = gitWith({ limit: MAX_DIFF_BYTES });

/**
 * A ref git will read as a ref and nothing else: no leading `-` (which git would take as an
 * option), no whitespace, no `..` of its own, and only the characters a branch, a tag, a sha
 * or `origin/x` uses.
 */
const REF = /^(?!-)(?!.*\.\.)[\w./@^~-]{1,255}$/u;

export function baseOf(io: Io, flag: string | undefined): string {
  const fromCi = io.env['GITHUB_BASE_REF'];
  const base = flag ?? io.env['LUPIN_BASE'] ?? (fromCi ? `origin/${fromCi}` : undefined);
  if (base === undefined || base === '') {
    throw usage('Name the branch to compare with: --base origin/main, or set LUPIN_BASE.');
  }
  if (!REF.test(base)) throw usage(`Not a git ref: ${base}`);
  return base;
}

const LABEL: Readonly<Record<TamperKind, string>> = {
  'test-deleted': 'test deleted',
  'skip-added': 'skip or focus added',
  'assertion-removed': 'assertion removed',
  'assertion-loosened': 'assertion loosened',
  'empty-catch': 'empty catch in a test',
  'snapshot-bulk-update': 'snapshot updated in bulk',
  'threshold-lowered': 'threshold lowered',
  'ci-made-non-failing': 'CI step can no longer fail',
  'retry-added': 'retry added',
};

const totalOf = (report: GuardReport) =>
  Object.values(report.counts).reduce((sum, value) => sum + value, 0);
const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

function printFindings(io: Io, report: GuardReport, total: number): void {
  for (const finding of report.findings.slice(0, LISTED)) {
    const where = finding.line === null ? finding.path : `${finding.path}:${String(finding.line)}`;
    const side = finding.side === 'base' ? ' (before the change)' : '';
    io.out(`  - ${LABEL[finding.kind]}: ${where}${side}`);
  }
  if (total > LISTED) io.out(`  …and ${String(total - LISTED)} more`);
}

function print(io: Io, report: GuardReport): void {
  const total = totalOf(report);
  const files = `${plural(report.filesChecked, 'file', 'files')} checked`;
  if (total === 0) {
    io.out(`diff-guard: no change weakens the tests (${files}).`);
  } else {
    io.out(`diff-guard: ${plural(total, 'change', 'changes')} weaken the tests (${files}):`);
    printFindings(io, report, total);
  }
  if (report.truncated) {
    io.out('diff-guard: the diff or the findings were cut short; counts are a lower bound.');
  }
}

interface GuardOptions {
  base: string;
  /** `null` on `--dry-run`: nothing is sent. */
  destination: ReturnType<typeof target> | null;
  commit: string | undefined;
  branch: string | undefined;
  pullRequest: number | undefined;
  failOnFindings: boolean;
}

/** The command line, checked before git runs: a bad flag or a missing token costs no diff. */
function readGuardOptions(argv: readonly string[], io: Io): GuardOptions {
  const parsed = parseOptions(argv, {
    values: ['project', 'base', 'branch', 'commit', 'pr'],
    switches: ['dry-run', 'fail-on-findings'],
  });
  const base = baseOf(io, optional(parsed, 'base'));
  const dryRun = parsed.switches.has('dry-run');
  const pullRequest = pullRequestOf(optional(parsed, 'pr'));
  const commit = commitOf(io, optional(parsed, 'commit'));
  if (!dryRun && commit === undefined) throw usage('--commit is required, or set LUPIN_COMMIT.');
  const branch = branchOf(io, optional(parsed, 'branch'));
  return {
    base,
    destination: dryRun ? null : target(io, parsed),
    commit,
    branch: branch === '' ? undefined : branch,
    pullRequest,
    failOnFindings: parsed.switches.has('fail-on-findings'),
  };
}

export async function diffGuard(
  argv: readonly string[],
  io: Io & { git?: Git },
): Promise<ExitCode> {
  const options = readGuardOptions(argv, io);
  const { base, destination, commit } = options;
  const diff = await (io.git ?? runGit)(
    ['diff', '--no-color', '--no-ext-diff', '--unified=0', '--find-renames', `${base}...HEAD`],
    io.cwd,
  );
  if (diff.code !== 0) {
    throw usage(
      `git diff ${base}...HEAD failed. Is ${base} fetched? On GitHub Actions, check out with fetch-depth: 0.`,
    );
  }
  const report = analyzeDiff(diff.stdout, { inputTruncated: diff.truncated });
  print(io, report);
  const exit = options.failOnFindings && totalOf(report) > 0 ? EXIT.gateFailed : EXIT.ok;
  if (destination === null || commit === undefined) return exit;

  await send(io.fetch, destination, projectUrl(destination, '/health/diff-guard'), {
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({
      commit,
      base,
      ...(options.branch === undefined ? {} : { branch: options.branch }),
      ...(options.pullRequest === undefined ? {} : { pullRequest: options.pullRequest }),
      report,
    }),
  });
  io.out(`diff-guard: sent the findings for ${commit.slice(0, 12)}.`);
  return exit;
}
