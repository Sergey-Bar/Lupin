import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZAP_MAX_SPIDER_MINUTES } from '@lupin/shared-contracts';
import {
  RunnerConfigurationError,
  RunnerInfrastructureError,
  type ExecutionContext,
} from './execution.js';
import {
  ZapExecutionAdapter,
  zapBaselineArguments,
  zapStatus,
  type ZapExecutionOptions,
} from './zap-execution.js';

/**
 * The ZAP baseline adapter against a fake process (no ZAP needed): the argv it builds, every
 * refusal that must happen before a spawn, and the report read through `@lupin/reporter`'s
 * `zap-xml` adapter into the run's tests. A real ZAP run is not recorded here (ledger BK-2).
 */

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  pid: number | undefined = 4242;
}

interface Behaviour {
  report?: string;
  code?: number | null;
  hang?: boolean;
  spawnError?: Error;
  stdout?: string;
  /** Write the report into this directory instead of the child's cwd (as /zap/wrk does). */
  writeInto?: string;
}

function report(alerts: string): string {
  return `<?xml version="1.0"?><OWASPZAPReport version="2.16.0"><site name="http://target.test:8080" host="target.test" port="8080"><alerts>${alerts}</alerts></site></OWASPZAPReport>`;
}

const CLEAN = report('');
const ONE_MEDIUM = report(
  '<alertitem><pluginid>10038</pluginid><alert>Content Security Policy (CSP) Header Not Set</alert><riskcode>2</riskcode><count>3</count><riskdesc>Medium (High)</riskdesc><solution>Set the header.</solution><cweid>693</cweid></alertitem>',
);
const ONE_INFO = report(
  '<alertitem><pluginid>10027</pluginid><alert>Information Disclosure</alert><riskcode>0</riskcode><count>1</count></alertitem>',
);
const UNKNOWN_RISK = report(
  '<alertitem><pluginid>1</pluginid><alert>New</alert><riskcode>7</riskcode><count>1</count></alertitem>',
);

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'lupin-zap-'));
  await mkdir(join(sandbox, 'workspaces'), { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

interface Call {
  command: string;
  args: string[];
  options: SpawnOptions;
}

function harness(
  behaviour: Behaviour = { report: CLEAN, code: 0 },
  overrides: Partial<ZapExecutionOptions> = {},
) {
  const calls: Call[] = [];
  const terminated: ChildProcessWithoutNullStreams[] = [];
  const workspaceRoot = join(sandbox, 'workspaces');
  const adapter = new ZapExecutionAdapter({
    workspaceRoot,
    allowedTargetUrls: ['http://target.test:8080'],
    artifactMaxBytes: 1024 * 1024,
    logMaxBytes: 64 * 1024,
    environment: {
      PATH: '/usr/bin',
      HOME: '/home/zap',
      JAVA_HOME: '/opt/java',
      GITHUB_TOKEN: 'ghp_should_never_reach_zap',
      DATABASE_URL: 'postgres://nope',
    },
    spawnProcess: (command, args, options) => {
      calls.push({ command, args: [...args], options });
      const child = new FakeChild();
      setImmediate(() => void runFake(child, [...args], String(options.cwd), behaviour));
      return child as unknown as ChildProcessWithoutNullStreams;
    },
    terminateProcess: (child) => {
      terminated.push(child);
      setImmediate(() => (child as unknown as FakeChild).emit('close', null, 'SIGKILL'));
      return Promise.resolve();
    },
    ...overrides,
  });
  return { adapter, calls, terminated, workspaceRoot };
}

async function runFake(
  child: FakeChild,
  args: string[],
  cwd: string,
  behaviour: Behaviour,
): Promise<void> {
  if (behaviour.spawnError !== undefined) {
    child.pid = undefined;
    child.emit('error', behaviour.spawnError);
    return;
  }
  const name = args[args.indexOf('-x') + 1] ?? '';
  if (behaviour.report !== undefined) {
    await writeFile(join(behaviour.writeInto ?? cwd, name), behaviour.report);
  }
  if (behaviour.stdout !== undefined) child.stdout.write(behaviour.stdout);
  if (behaviour.hang === true) return;
  child.exitCode = behaviour.code ?? 0;
  child.emit('close', child.exitCode, null);
}

const JOB = { scan: 'baseline', spiderMinutes: 2 };

function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    jobId: 'job-1',
    zap: JOB,
    targetUrl: 'http://target.test:8080/',
    deadlineMs: 30_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function collect(events: Array<{ type: string; payload: Record<string, unknown> }>) {
  return (event: { type: string; payload: Record<string, unknown> }) => {
    events.push(event);
    return Promise.resolve();
  };
}

describe('the spawn', () => {
  it('runs a baseline scan only, with an argv built from the bounded job', async () => {
    const h = harness();
    await h.adapter.execute(context());
    const call = h.calls[0];
    expect(call?.command).toBe('zap-baseline.py');
    expect(call?.args).toEqual([
      '-t',
      'http://target.test:8080/',
      '-x',
      'zap-report-job-1.xml',
      '-m',
      '2',
      '-I',
    ]);
    expect(call?.args).toEqual(
      zapBaselineArguments(
        { scan: 'baseline', spiderMinutes: 2 },
        'http://target.test:8080/',
        'zap-report-job-1.xml',
      ),
    );
    expect(call?.options.shell).toBe(false);
    expect(call?.options.detached).toBe(process.platform !== 'win32');
  });

  it('uses the configured command, and an allowlisted environment without the runner’s secrets', async () => {
    const h = harness(undefined, { zapCommand: '/zap/zap-baseline.py' });
    await h.adapter.execute(context());
    expect(h.calls[0]?.command).toBe('/zap/zap-baseline.py');
    const env = h.calls[0]?.options.env ?? {};
    expect(env['JAVA_HOME']).toBe('/opt/java');
    expect(Object.keys(env).join(',')).not.toMatch(/TOKEN|DATABASE/u);
    expect(JSON.stringify(env)).not.toContain('ghp_should_never_reach_zap');
  });
});

describe('refusals happen before anything is spawned or created', () => {
  it.each([
    ['no zap block', { zap: undefined }, /ZAP job configuration is invalid/u],
    ['a full (active) scan', { zap: { scan: 'full', spiderMinutes: 1 } }, /scan/u],
    [
      'too many minutes',
      { zap: { ...JOB, spiderMinutes: ZAP_MAX_SPIDER_MINUTES + 1 } },
      /spiderMinutes/u,
    ],
    ['an extra field', { zap: { ...JOB, args: ['-a'] } }, /ZAP job configuration/u],
    [
      'a target outside the allowlist',
      { targetUrl: 'http://evil.test:8080/' },
      /not allowlisted: http:\/\/evil\.test:8080/u,
    ],
    [
      'the right host on the wrong port',
      { targetUrl: 'http://target.test:9/' },
      /not allowlisted/u,
    ],
    ['no target at all', { targetUrl: undefined }, /invalid/u],
    ['a target with credentials', { targetUrl: 'http://u:p@target.test:8080/' }, /not allowed/u],
    ['a file: target', { targetUrl: 'file:///etc/passwd' }, /not allowed/u],
    ['a zero deadline', { deadlineMs: 0 }, /positive integer/u],
  ] satisfies Array<[string, Partial<ExecutionContext>, RegExp]>)(
    'refuses %s as a configuration failure',
    async (_name, overrides, message) => {
      const h = harness();
      const attempt = h.adapter.execute(context(overrides));
      await expect(attempt).rejects.toBeInstanceOf(RunnerConfigurationError);
      await expect(h.adapter.execute(context(overrides))).rejects.toThrow(message);
      expect(h.calls).toHaveLength(0);
      expect(await readdir(h.workspaceRoot)).toEqual([]);
    },
  );
});

describe('the verdict comes from the zap-xml adapter', () => {
  it('a clean report is passed, as one test, uploaded under the zap-xml kind', async () => {
    const h = harness({ report: CLEAN, code: 0 });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const result = await h.adapter.execute(context({ onEvent: collect(events) }));
    expect(result.status).toBe('passed');
    expect(result.error).toBeUndefined();
    const completed = events.filter((event) => event.type === 'test.completed');
    expect(completed.map((event) => [event.payload['testId'], event.payload['status']])).toEqual([
      ['zap.scan', 'passed'],
    ]);
    expect(result.artifacts.map((artifact) => [artifact.name, artifact.kind])).toEqual([
      ['stderr.log', 'stderr'],
      ['stdout.log', 'stdout'],
      ['zap-report-job-1.xml', 'zap-xml'],
    ]);
    expect(await readFile(result.resultPath, 'utf8')).toBe(CLEAN);
  });

  it('a Medium alert fails the run even on a clean exit (-I), naming the alert', async () => {
    const h = harness({ report: ONE_MEDIUM, code: 0 });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const result = await h.adapter.execute(context({ onEvent: collect(events) }));
    expect(result.status).toBe('failed');
    const failure = events.find((event) => event.payload['status'] === 'failed');
    expect(failure?.payload).toMatchObject({
      testId: 'zap.10038',
      suite: 'zap',
      errorCode: 'ZAP_ALERT',
      title: 'Content Security Policy (CSP) Header Not Set (3 occurrences)',
    });
  });

  it('an Informational-only report is a clean scan: passed, with the alert recorded as skipped', async () => {
    const h = harness({ report: ONE_INFO, code: 0 });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const result = await h.adapter.execute(context({ onEvent: collect(events) }));
    expect(result.status).toBe('passed');
    expect(events.find((event) => event.type === 'test.completed')?.payload['status']).toBe(
      'skipped',
    );
  });

  it('a FAIL exit is a failure even when the report reads clean', async () => {
    const h = harness({ report: CLEAN, code: 1 });
    expect((await h.adapter.execute(context())).status).toBe('failed');
  });

  it.each([
    ['a clean exit and no report', { code: 0 }, /wrote no report/u],
    ['exit 3 (ZAP itself failed)', { report: CLEAN, code: 3 }, /exited with 3/u],
    ['a report that is not ZAP’s', { report: '<html/>', code: 0 }, /could not be read/u],
    ['an alert of a risk this build cannot read', { report: UNKNOWN_RISK, code: 0 }, /risk/u],
  ] satisfies Array<[string, Behaviour, RegExp]>)(
    '%s is an infrastructure failure, never a pass',
    async (_name, behaviour, message) => {
      const result = await harness(behaviour).adapter.execute(context());
      expect(result.status).toBe('infra_failed');
      expect(result.error).toMatchObject({ code: 'RUNNER_INFRA_FAILED' });
      expect(result.error?.message).toMatch(message);
    },
  );

  it('moves the report out of the configured ZAP work directory before reading it', async () => {
    const workDir = join(sandbox, 'zap-wrk');
    await mkdir(workDir);
    const h = harness({ report: ONE_MEDIUM, code: 0, writeInto: workDir }, { workDir });
    const result = await h.adapter.execute(context());
    expect(result.status).toBe('failed');
    expect(result.resultPath.startsWith(result.workspacePath)).toBe(true);
    expect(await readdir(workDir)).toEqual([]);
  });

  it('redacts registered secrets from the logs', async () => {
    const h = harness({ report: CLEAN, stdout: 'cookie=s3cr3t\n', code: 0 });
    const result = await h.adapter.execute(context({ redactions: ['s3cr3t'] }));
    expect(result.stdout).toBe('cookie=[REDACTED]\n');
  });

  it('an event the API could not take is infrastructure, not a result', async () => {
    const h = harness({ report: ONE_MEDIUM, code: 0 });
    const result = await h.adapter.execute(
      context({ onEvent: () => Promise.reject(new Error('event ingest refused')) }),
    );
    expect(result.status).toBe('infra_failed');
    expect(result.error?.message).toContain('event ingest refused');
  });

  it('an artifact over the limit fails the run and leaves no workspace behind', async () => {
    const h = harness({ report: ONE_MEDIUM, code: 0 }, { artifactMaxBytes: 20 });
    await expect(h.adapter.execute(context())).rejects.toBeInstanceOf(RunnerInfrastructureError);
    expect(await readdir(h.workspaceRoot)).toEqual([]);
  });
});

describe('time, cancellation and a missing binary', () => {
  it('stops ZAP at the deadline and reports timed_out', async () => {
    const h = harness({ hang: true });
    expect((await h.adapter.execute(context({ deadlineMs: 30 }))).status).toBe('timed_out');
    expect(h.terminated).toHaveLength(1);
  });

  it('stops ZAP when the job is cancelled', async () => {
    const h = harness({ hang: true });
    const controller = new AbortController();
    const pending = h.adapter.execute(context({ signal: controller.signal }));
    await new Promise((settle) => setTimeout(settle, 20));
    controller.abort();
    expect((await pending).status).toBe('cancelled');
  });

  it('a ZAP that is not installed is a clear infrastructure failure', async () => {
    const h = harness({ spawnError: new Error('spawn zap-baseline.py ENOENT') });
    const result = await h.adapter.execute(context());
    expect(result.status).toBe('infra_failed');
    expect(result.error?.message).toMatch(/could not be started.*RUNNER_ZAP_COMMAND.*ENOENT/u);
  });
});

describe('cleanup', () => {
  it('removes its workspace and refuses a path outside the workspace root', async () => {
    const h = harness();
    const result = await h.adapter.execute(context());
    expect(existsSync(result.workspacePath)).toBe(true);
    await h.adapter.cleanup(result.workspacePath);
    expect(existsSync(result.workspacePath)).toBe(false);
    await expect(h.adapter.cleanup(sandbox)).rejects.toBeInstanceOf(RunnerConfigurationError);
  });
});

describe('zapStatus', () => {
  const exit = (code: number | null, extra: { timedOut?: boolean; spawnError?: Error } = {}) => ({
    code,
    timedOut: extra.timedOut ?? false,
    spawnError: extra.spawnError,
  });
  const base = { aborted: false, deliveryError: undefined };

  it.each([
    [exit(0), 'passed', 'passed'],
    [exit(2), 'passed', 'passed'],
    [exit(0), 'failed', 'failed'],
    [exit(1), 'passed', 'failed'],
    [exit(0), 'unknown', 'infra_failed'],
    [exit(0), 'skipped', 'passed'],
    [exit(0), undefined, 'infra_failed'],
    [exit(3), 'passed', 'infra_failed'],
    [exit(null), 'passed', 'infra_failed'],
    [exit(0, { timedOut: true }), 'passed', 'timed_out'],
    [exit(0, { spawnError: new Error('x') }), 'passed', 'infra_failed'],
  ] as const)('%j with a %s reading is %s', (processExit, verdict, expected) => {
    expect(zapStatus({ ...base, exit: processExit, verdict })).toBe(expected);
  });
});
