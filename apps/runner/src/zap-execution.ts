import { type ChildProcessWithoutNullStreams, spawn, type SpawnOptions } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ZAP_XML_ADAPTER_VERSION, parseZapReport } from '@lupin/reporter';
import {
  ZapJobConfigurationSchema,
  type CanonicalRunResult,
  type ExecutionEventLine,
  type ZapJobConfiguration,
} from '@lupin/shared-contracts';
import { artifactKind } from './artifact-kind.js';
import {
  CappedLog,
  RunnerConfigurationError,
  RunnerInfrastructureError,
  assertAllowedTarget,
  collectFiles,
  contentType,
  sanitizeEnvironment,
  sanitizeError,
  terminateProcessTree,
  type ExecutionArtifact,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
  type ExecutionStatus,
  type ProcessSpawner,
} from './execution.js';
import { WINDOWS_ENV_ALLOWLIST } from './windows-command.js';

/**
 * Runs one OWASP ZAP **baseline** scan and turns its XML report into test events (plan task 17,
 * ledger BK-2).
 *
 * ## Baseline only, and the argv is built here
 *
 * The job carries `configuration.zap = { scan: 'baseline', spiderMinutes }` and a target, both
 * re-parsed against the contract (`ZapJobConfigurationSchema`). The command is the operator's
 * (`RUNNER_ZAP_COMMAND`, default `zap-baseline.py`) and the arguments are this file's:
 * `-t <target> -x <report.xml> -m <minutes> -I`. The baseline spiders the target and reports what
 * ZAP's passive rules saw; it sends no attack payloads. Nothing a caller sends becomes a flag, so
 * there is no way to ask for an active scan, a rules file or an add-on.
 *
 * ## What is bounded, and by whom
 *
 * - **Target**: the same origin allowlist (`RUNNER_ALLOWED_TARGET_URLS`) the Playwright, k6 and
 *   API adapters apply, through the one `assertAllowedTarget`. The spider follows links within
 *   the target, so the allowlist names what is scanned; it does not sandbox the network. The
 *   runner image's network is what does that (`infra/runners/zap/manifest.json`).
 * - **Time**: the job's deadline stops the whole process tree, as do cancellation and shutdown.
 *
 * ## Where the verdict comes from
 *
 * `@lupin/reporter`'s `parseZapReport` is the only reader of the report: an alert of risk Low or
 * above is a failed test, Informational is skipped, and an unrecognised risk is `unknown`, which
 * is never a pass. The exit status must agree: `zap-baseline.py` exits `0` (clean, or warnings
 * under `-I`), `1` (a rule at FAIL) or `2` (warnings without `-I`); anything else, and a run with
 * no readable report, is ZAP failing rather than the target passing.
 *
 * ## Where the report is
 *
 * `zap-baseline.py` writes reports under `/zap/wrk/` whenever that directory exists, whatever
 * path `-x` names. So the report name is relative, the child runs in the job's workspace, and
 * when `workDir` (`RUNNER_ZAP_WORK_DIR`, `/zap/wrk` in the image) is set the report is moved from
 * there into the workspace before it is read.
 */

/** `zap-baseline.py`'s exit codes that are answers about the target. */
export const ZAP_VERDICT_EXITS: ReadonlySet<number> = new Set([0, 1, 2]);
/** `zap-baseline.py`'s exit code for "at least one rule is at FAIL". */
export const ZAP_FAIL_EXIT = 1;

const BASE_ENV_ALLOWLIST: readonly string[] = ['PATH', 'HOME', 'CI', 'JAVA_HOME', 'LANG'];

export interface ZapExecutionOptions {
  allowedTargetUrls: readonly string[];
  workspaceRoot: string;
  artifactMaxBytes: number;
  logMaxBytes: number;
  /** `RUNNER_ZAP_COMMAND`. Defaults to `zap-baseline.py` on `PATH`. */
  zapCommand?: string;
  /** `RUNNER_ZAP_WORK_DIR`: where the script writes its report, when it is not the workspace. */
  workDir?: string;
  redactions?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: ProcessSpawner;
  terminateProcess?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  now?: () => Date;
}

interface ZapExit {
  code: number | null;
  timedOut: boolean;
  spawnError: Error | undefined;
}

interface ZapReading {
  result: CanonicalRunResult | null;
  problem: string | undefined;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  return spawn(command, [...args], { ...options, shell: false, stdio: 'pipe' });
}

/** The argv, built here and nowhere else. `-I`: a WARN rule does not fail the exit status. */
export function zapBaselineArguments(
  job: ZapJobConfiguration,
  target: string,
  reportName: string,
): string[] {
  return ['-t', target, '-x', reportName, '-m', String(job.spiderMinutes), '-I'];
}

export class ZapExecutionAdapter implements ExecutionProvider {
  private readonly workspaceRoot: string;
  private readonly allowedTargets: ReadonlySet<string>;
  private readonly zapCommand: string;
  private readonly spawnProcess: ProcessSpawner;
  private readonly terminateProcess: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly redactions: readonly string[];
  private readonly now: () => Date;

  constructor(private readonly options: ZapExecutionOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.allowedTargets = new Set(options.allowedTargetUrls.map((value) => new URL(value).origin));
    this.zapCommand = options.zapCommand ?? 'zap-baseline.py';
    this.spawnProcess = options.spawnProcess ?? defaultSpawn;
    this.terminateProcess = options.terminateProcess ?? terminateProcessTree;
    this.environment = options.environment ?? process.env;
    this.redactions = [...new Set(options.redactions ?? [])];
    this.now = options.now ?? (() => new Date());
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const redactions = [...new Set([...this.redactions, ...(context.redactions ?? [])])];
    const job = readZapJob(context);
    const target = assertAllowedTarget(context.targetUrl ?? '', this.allowedTargets);

    await mkdir(this.workspaceRoot, { recursive: true });
    const workspacePath = await mkdtemp(join(this.workspaceRoot, `${safeSegment(context.jobId)}-`));
    try {
      return await this.scan({ context, job, target, workspacePath, redactions });
    } catch (error) {
      await rm(workspacePath, { recursive: true, force: true });
      if (error instanceof RunnerConfigurationError || error instanceof RunnerInfrastructureError) {
        throw error;
      }
      throw new RunnerInfrastructureError(sanitizeError(error, redactions));
    }
  }

  async cleanup(workspacePath: string): Promise<void> {
    const inside = relative(this.workspaceRoot, resolve(workspacePath));
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
      throw new RunnerConfigurationError('Path is outside the configured runner workspace');
    }
    await rm(workspacePath, { recursive: true, force: true });
  }

  private async scan(run: {
    context: ExecutionContext;
    job: ZapJobConfiguration;
    target: string;
    workspacePath: string;
    redactions: readonly string[];
  }): Promise<ExecutionResult> {
    const { context, workspacePath, redactions } = run;
    const startedAt = this.now();
    const reportName = `zap-report-${safeSegment(context.jobId)}.xml`;
    const child = this.spawnProcess(
      this.zapCommand,
      zapBaselineArguments(run.job, run.target, reportName),
      {
        cwd: workspacePath,
        env: this.childEnvironment(redactions),
        detached: process.platform !== 'win32',
        shell: false,
        stdio: 'pipe',
        windowsHide: true,
      },
    );
    const stdout = new CappedLog(this.options.logMaxBytes);
    const stderr = new CappedLog(this.options.logMaxBytes);
    child.stdout.on('data', (chunk: Buffer | string) => stdout.append(chunk));
    child.stderr.on('data', (chunk: Buffer | string) => stderr.append(chunk));
    const exit = await this.supervise(child, context);

    const stdoutText = redact(stdout.text, redactions);
    const stderrText = redact(stderr.text, redactions);
    await Promise.all([
      writeFile(join(workspacePath, 'stdout.log'), stdoutText),
      writeFile(join(workspacePath, 'stderr.log'), stderrText),
    ]);

    const reportPath = await this.adoptReport(reportName, workspacePath);
    const reading = await this.readReport(reportPath, context, startedAt);
    const deliveryError = await deliver(reading.result, context, this.now());
    const artifacts = await this.collectArtifacts(workspacePath);
    const status = zapStatus({
      exit,
      aborted: context.signal.aborted,
      deliveryError,
      verdict: reading.result?.status,
    });
    const message = failureMessage(status, exit, reading, deliveryError);
    return {
      status,
      resultPath: artifacts.find((artifact) => artifact.kind === 'zap-xml')?.path ?? '',
      workspacePath,
      artifacts,
      stdout: stdoutText,
      stderr: stderrText,
      error:
        message === undefined
          ? undefined
          : {
              code: status === 'infra_failed' ? 'RUNNER_INFRA_FAILED' : 'EXECUTION_ERROR',
              message: redact(sanitizeError(message, redactions), redactions),
            },
    };
  }

  /** PATH, HOME and the JVM's settings; never the runner's credentials. */
  private childEnvironment(redactions: readonly string[]): NodeJS.ProcessEnv {
    const allowed = [
      ...BASE_ENV_ALLOWLIST,
      ...(process.platform === 'win32' ? WINDOWS_ENV_ALLOWLIST : []),
    ];
    const base = sanitizeEnvironment(this.environment, redactions);
    const env: NodeJS.ProcessEnv = {};
    for (const key of allowed) {
      const value = base[key];
      if (value !== undefined) env[key] = value;
    }
    return env;
  }

  private async supervise(
    child: ChildProcessWithoutNullStreams,
    context: ExecutionContext,
  ): Promise<ZapExit> {
    let timedOut = false;
    let spawnError: Error | undefined;
    const stop = (): void => void this.terminateProcess(child);
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, context.deadlineMs);
    context.signal.addEventListener('abort', stop, { once: true });
    if (context.signal.aborted) stop();
    try {
      const code = await new Promise<number | null>((settle) => {
        child.once('error', (error) => {
          spawnError = error;
          if (child.pid === undefined) settle(null);
        });
        child.once('close', (exitCode: number | null) => settle(exitCode));
      });
      return { code, timedOut, spawnError };
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener('abort', stop);
    }
  }

  /** The report in the workspace, moved from the ZAP work directory when one is configured. */
  private async adoptReport(reportName: string, workspacePath: string): Promise<string> {
    const inWorkspace = join(workspacePath, reportName);
    if (this.options.workDir === undefined) return inWorkspace;
    const written = join(resolve(this.options.workDir), reportName);
    const found = await stat(written).catch(() => undefined);
    if (found?.isFile() === true) {
      await copyFile(written, inWorkspace);
      await rm(written, { force: true });
    }
    return inWorkspace;
  }

  private async readReport(
    reportPath: string,
    context: ExecutionContext,
    startedAt: Date,
  ): Promise<ZapReading> {
    // One handle for the size and the read, so a report that changes after the check is
    // still bounded (CodeQL js/file-system-race), the same shape as k6's summary.
    const handle = await open(reportPath, 'r').catch(() => undefined);
    if (handle === undefined) return { result: null, problem: 'ZAP wrote no report' };
    let bytes: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile()) return { result: null, problem: 'ZAP wrote no report' };
      if (info.size > this.options.artifactMaxBytes) {
        throw new RunnerInfrastructureError('Artifact exceeds configured limit: ZAP report');
      }
      // One byte past the observed size, so growth after the stat is seen.
      const buffer = Buffer.alloc(info.size + 1);
      let read = 0;
      while (read < buffer.length) {
        const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      if (read > info.size) {
        throw new RunnerInfrastructureError('Artifact changed while it was read: ZAP report');
      }
      bytes = buffer.subarray(0, read);
    } finally {
      await handle.close();
    }
    try {
      return {
        problem: undefined,
        result: parseZapReport(bytes, {
          // Identity belongs to the API's run; only the attempts are used.
          workspaceId: 'runner',
          runId: context.jobId,
          sourceUri: 'zap-report.xml',
          sourceDigest: createHash('sha256').update(bytes).digest('hex'),
          producerVersion: 'zap-baseline',
          adapterVersion: ZAP_XML_ADAPTER_VERSION,
          startedAt: startedAt.toISOString(),
          finishedAt: this.now().toISOString(),
        }),
      };
    } catch (error) {
      return { result: null, problem: `ZAP report could not be read: ${sanitizeError(error, [])}` };
    }
  }

  private async collectArtifacts(workspacePath: string): Promise<ExecutionArtifact[]> {
    const artifacts: ExecutionArtifact[] = [];
    for (const path of await collectFiles(workspacePath)) {
      const bytes = await readFile(path);
      if (bytes.byteLength > this.options.artifactMaxBytes) {
        throw new RunnerInfrastructureError(
          `Artifact exceeds configured limit: ${relative(workspacePath, path)}`,
        );
      }
      artifacts.push({
        path,
        digest: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength,
        kind: artifactKind(path),
        name: relative(workspacePath, path).replaceAll('\\', '/'),
        contentType: contentType(path),
      });
    }
    return artifacts;
  }
}

function readZapJob(context: ExecutionContext): ZapJobConfiguration {
  const parsed = ZapJobConfigurationSchema.safeParse(context.zap);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RunnerConfigurationError(
      `ZAP job configuration is invalid: ${issue?.path.join('.') || 'zap'} ${issue?.message ?? ''}`.trim(),
    );
  }
  if (!Number.isInteger(context.deadlineMs) || context.deadlineMs < 1) {
    throw new RunnerConfigurationError('Execution timeout must be a positive integer');
  }
  return parsed.data;
}

/**
 * How the scan ended, most specific first, as `loadStatus` does for k6: an event the API never
 * received, the deadline, an abort, a child that never started. Then the exit code must be one
 * of ZAP's answers and the report must be readable; a FAIL exit or a failed reading is a
 * failure, and only a passed reading with a verdict exit is a pass.
 */
export function zapStatus(outcome: {
  exit: ZapExit;
  aborted: boolean;
  deliveryError: unknown;
  verdict: CanonicalRunResult['status'] | undefined;
}): ExecutionStatus {
  if (outcome.deliveryError !== undefined && outcome.deliveryError !== null) return 'infra_failed';
  if (outcome.exit.timedOut) return 'timed_out';
  if (outcome.aborted) return 'cancelled';
  if (outcome.exit.spawnError !== undefined) return 'infra_failed';
  const code = outcome.exit.code;
  if (code === null || !ZAP_VERDICT_EXITS.has(code)) return 'infra_failed';
  if (outcome.verdict === undefined) return 'infra_failed';
  if (code === ZAP_FAIL_EXIT || outcome.verdict === 'failed') return 'failed';
  // `skipped` is the zap-xml reading of a report whose only alerts are Informational: the scan
  // ran and found nothing actionable, which is the clean scan the adapter calls a pass.
  return outcome.verdict === 'passed' || outcome.verdict === 'skipped' ? 'passed' : 'infra_failed';
}

function failureMessage(
  status: ExecutionStatus,
  exit: ZapExit,
  reading: ZapReading,
  deliveryError: unknown,
): string | undefined {
  if (deliveryError !== undefined && deliveryError !== null) {
    return sanitizeError(deliveryError, []);
  }
  if (exit.spawnError !== undefined) {
    return `ZAP baseline could not be started (is it installed? RUNNER_ZAP_COMMAND): ${exit.spawnError.message}`;
  }
  if (status !== 'infra_failed') return undefined;
  if (exit.code === null || !ZAP_VERDICT_EXITS.has(exit.code)) {
    return `ZAP baseline exited with ${String(exit.code)}`;
  }
  return reading.problem ?? 'ZAP report raised an alert of a risk this build cannot read';
}

/** Each alert as `test.started` / `test.completed`. Returns the first delivery failure. */
async function deliver(
  result: CanonicalRunResult | null,
  context: ExecutionContext,
  at: Date,
): Promise<unknown> {
  if (result === null || context.onEvent === undefined) return undefined;
  try {
    let sequence = 0;
    for (const attempt of result.attempts) {
      for (const event of alertEvents(attempt, at, () => (sequence += 1))) {
        await context.onEvent(event);
      }
    }
    return undefined;
  } catch (error) {
    return error;
  }
}

function alertEvents(
  attempt: CanonicalRunResult['attempts'][number],
  at: Date,
  nextSequence: () => number,
): ExecutionEventLine[] {
  const base = {
    testId: attempt.testId,
    attempt: attempt.index,
    title: attempt.title,
    suite: 'zap',
    file: attempt.specPath,
  };
  const failed = attempt.status === 'failed';
  return [
    {
      eventId: randomUUID(),
      sequence: nextSequence(),
      type: 'test.started',
      occurredAt: at.toISOString(),
      payload: base,
    },
    {
      eventId: randomUUID(),
      sequence: nextSequence(),
      type: 'test.completed',
      occurredAt: at.toISOString(),
      payload: {
        ...base,
        status: attempt.status,
        durationMs: 0,
        ...(failed
          ? {
              errorCode: 'ZAP_ALERT',
              errors: [{ message: attempt.error?.message ?? 'ZAP raised an alert' }],
            }
          : {}),
      },
    },
  ];
}

function redact(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (secret) result = result.replaceAll(secret, '[REDACTED]');
  }
  return result;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 80) || 'job';
}
