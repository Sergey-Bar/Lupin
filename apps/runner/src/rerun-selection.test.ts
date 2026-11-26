import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { testIdentity } from '@lupin/shared-contracts';
import { PlaywrightExecutionAdapter, testListLines } from './execution.js';

/**
 * A rerun of the failed tests runs only those tests (ledger MNT-206).
 *
 * The retry route stored the failed tests as the run's `selection` and nothing in the runner
 * read it, so the rerun ran the whole suite. The selection is now written to a test-list file
 * and passed to Playwright as `--test-list`, which is Playwright's own filter.
 */

const here = dirname(fileURLToPath(import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const red = testIdentity({
  file: 'e2e/cart.spec.ts',
  describePath: ['Cart'],
  title: 'applies a coupon',
  project: 'chromium',
});
const slow = testIdentity({ file: 'e2e/pay.spec.ts', title: 'pays by card' });

describe('testListLines', () => {
  it('turns identities into --test-list lines, once each', () => {
    expect(testListLines([red, slow, red])).toEqual([
      '[chromium] › e2e/cart.spec.ts › Cart › applies a coupon',
      'e2e/pay.spec.ts › pays by card',
    ]);
  });

  it('names nothing for a row id, a fileless test, or a title with a line break', () => {
    expect(
      testListLines([
        'went-red',
        testIdentity({ file: null, title: 'x' }),
        testIdentity({ file: 'a.spec.ts', title: 'two\nlines' }),
      ]),
    ).toEqual([]);
    expect(testListLines(undefined)).toEqual([]);
  });
});

function recordingSpawn(calls: Array<{ args: readonly string[] }>) {
  return (_command: string, args: readonly string[]) => {
    calls.push({ args: [...args] });
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: 4242,
      exitCode: 0,
    });
    setTimeout(() => child.emit('close', 0, null), 5).unref();
    return child as unknown as ChildProcessWithoutNullStreams;
  };
}

async function run(selection: readonly string[] | undefined) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'runner-rerun-'));
  roots.push(workspaceRoot);
  const calls: Array<{ args: readonly string[] }> = [];
  const adapter = new PlaywrightExecutionAdapter({
    projectRoot: join(here, '..', 'fixtures', 'playwright-smoke'),
    allowedProjects: ['smoke-pass'],
    allowedTargetUrls: ['https://allowed.test'],
    workspaceRoot,
    artifactMaxBytes: 1_000_000,
    logMaxBytes: 10_000,
    environment: { PATH: process.env['PATH'] },
    spawnProcess: recordingSpawn(calls) as never,
    playwrightCliPath: 'playwright-cli.js',
  });
  const result = await adapter.execute({
    jobId: 'rerun-1',
    project: 'smoke-pass',
    targetUrl: 'https://allowed.test',
    deadlineMs: 5_000,
    signal: new AbortController().signal,
    ...(selection === undefined ? {} : { selection }),
  });
  return { args: calls[0]?.args ?? [], workspacePath: result.workspacePath };
}

describe('the Playwright adapter and a rerun', () => {
  it('passes the failed tests to Playwright as a test list', async () => {
    const { args } = await run([red, slow]);
    const at = args.indexOf('--test-list');
    expect(at).toBeGreaterThan(-1);
    const list = await readFile(args[at + 1] ?? '', 'utf8');
    expect(list.trim().split('\n')).toEqual([
      '[chromium] › e2e/cart.spec.ts › Cart › applies a coupon',
      'e2e/pay.spec.ts › pays by card',
    ]);
  });

  it('runs everything, as before, when the run names no tests', async () => {
    expect((await run(undefined)).args).not.toContain('--test-list');
    expect((await run([])).args).not.toContain('--test-list');
  });
});
