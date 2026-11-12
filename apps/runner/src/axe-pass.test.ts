import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AXE_RESULTS_NAME,
  AxePassAdapter,
  createHealthReportUploader,
  type AxeUpload,
} from './axe-pass.js';
import type {
  ExecutionArtifact,
  ExecutionContext,
  ExecutionProvider,
  ExecutionResult,
  ExecutionStatus,
} from './execution.js';

const AXE = JSON.stringify([
  {
    url: 'http://target.test/',
    testEngine: { name: 'axe-core', version: '4.10.0' },
    violations: [],
    passes: [{ id: 'image-alt' }],
  },
]);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lupin-axe-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function artifact(): Promise<ExecutionArtifact> {
  const path = join(dir, 'axe-results.json');
  await writeFile(path, AXE);
  return {
    path,
    digest: 'd',
    bytes: AXE.length,
    kind: 'evidence',
    name: AXE_RESULTS_NAME,
    contentType: 'application/json',
  };
}

function playwright(status: ExecutionStatus, artifacts: ExecutionArtifact[]): ExecutionProvider {
  const result: ExecutionResult = {
    status,
    resultPath: '',
    workspacePath: dir,
    artifacts,
    stdout: '',
    stderr: '',
  };
  return { execute: () => Promise.resolve(result) };
}

function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    jobId: 'job-1',
    deadlineMs: 1_000,
    signal: new AbortController().signal,
    projectId: 'project-1',
    commit: 'abc1234',
    branch: 'main',
    ...overrides,
  };
}

describe('AxePassAdapter', () => {
  it('changes nothing, and uploads nothing, when the job did not opt in', async () => {
    const upload = vi.fn<(input: AxeUpload) => Promise<void>>();
    const adapter = new AxePassAdapter(playwright('passed', [await artifact()]), upload);
    const result = await adapter.execute(context());
    expect(result.status).toBe('passed');
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads the file the fixture wrote, unread, for the job’s project, commit and branch', async () => {
    const uploads: AxeUpload[] = [];
    const adapter = new AxePassAdapter(playwright('passed', [await artifact()]), (input) => {
      uploads.push(input);
      return Promise.resolve();
    });
    const result = await adapter.execute(context({ axe: true }));
    expect(result.status).toBe('passed');
    expect(result.error).toBeUndefined();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ projectId: 'project-1', commit: 'abc1234', branch: 'main' });
    expect(Buffer.from(uploads[0]?.bytes ?? []).toString('utf8')).toBe(AXE);
  });

  it.each([
    ['no results file', async (): Promise<ExecutionArtifact[]> => [], undefined, 'AXE_NO_RESULTS'],
    [
      'no project to file under',
      async (): Promise<ExecutionArtifact[]> => [await artifact()],
      { projectId: undefined },
      'AXE_NO_PROJECT',
    ],
  ] as const)(
    'a passing run with %s is failed, never a pass',
    async (_name, artifacts, overrides, code) => {
      const upload = vi.fn<(input: AxeUpload) => Promise<void>>();
      const adapter = new AxePassAdapter(playwright('passed', await artifacts()), upload);
      const result = await adapter.execute(context({ axe: true, ...overrides }));
      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe(code);
      expect(upload).not.toHaveBeenCalled();
    },
  );

  it('a refused upload fails the run with the door’s answer', async () => {
    const adapter = new AxePassAdapter(playwright('passed', [await artifact()]), () =>
      Promise.reject(new Error('the health door answered 401')),
    );
    const result = await adapter.execute(context({ axe: true }));
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'AXE_UPLOAD_FAILED', message: expect.stringContaining('401') },
    });
  });

  it('keeps a failed run’s own status and error, and still files the results it wrote', async () => {
    const upload = vi.fn<(input: AxeUpload) => Promise<void>>().mockResolvedValue(undefined);
    const adapter = new AxePassAdapter(playwright('failed', [await artifact()]), upload);
    const result = await adapter.execute(context({ axe: true }));
    expect(result.status).toBe('failed');
    expect(result.error).toBeUndefined();
    expect(upload).toHaveBeenCalledOnce();
  });

  it('does not run the pass for a run that timed out or could not start', async () => {
    const upload = vi.fn<(input: AxeUpload) => Promise<void>>();
    for (const status of ['timed_out', 'cancelled', 'infra_failed'] as const) {
      const adapter = new AxePassAdapter(playwright(status, []), upload);
      expect((await adapter.execute(context({ axe: true }))).status).toBe(status);
    }
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('createHealthReportUploader', () => {
  it('posts axe-json to the project’s health door with the bearer and the commit', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const upload = createHealthReportUploader({
      apiUrl: 'https://lupin.test',
      token: 'lup_upload',
      timeoutMs: 1_000,
      fetch: (url, init) => {
        calls.push({ url: String(url), init });
        return Promise.resolve(new Response(null, { status: 201 }));
      },
    });
    await upload({
      projectId: 'p/1',
      commit: 'abc1234',
      branch: 'main',
      bytes: new TextEncoder().encode(AXE),
    });
    expect(calls[0]?.url).toBe(
      'https://lupin.test/api/v1/projects/p%2F1/health/reports?format=axe-json&commit=abc1234&branch=main',
    );
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer lup_upload');
  });

  it('omits a commit the door would refuse, sends no bearer without a token, and throws on a refusal', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const upload = createHealthReportUploader({
      apiUrl: 'https://lupin.test',
      timeoutMs: 1_000,
      fetch: (url, init) => {
        calls.push({ url: String(url), init });
        return Promise.resolve(new Response(null, { status: 401 }));
      },
    });
    await expect(
      upload({ projectId: 'p', commit: 'not-a-sha', bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/answered 401/u);
    expect(calls[0]?.url).toBe(
      'https://lupin.test/api/v1/projects/p/health/reports?format=axe-json',
    );
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBeNull();
  });
});
