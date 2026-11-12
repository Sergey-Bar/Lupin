import { readFile } from 'node:fs/promises';
import type {
  ExecutionArtifact,
  ExecutionContext,
  ExecutionProvider,
  ExecutionResult,
} from './execution.js';

/**
 * The opt-in axe pass on a Playwright job (plan task 18).
 *
 * ## What the runner does, and what the project does
 *
 * A job whose `configuration.axe` is `true` gets `LUPIN_AXE=1` and `LUPIN_AXE_RESULTS_PATH` in the
 * Playwright child's environment (`PlaywrightExecutionAdapter`). The runner cannot inject axe into
 * a page on its own: the project's own Playwright fixture runs `@axe-core/playwright` on each
 * page it visits while `LUPIN_AXE` is set and writes the results, as an array, to that path
 * (`site/guide/repository-health.md`, "axe from a runner job", shows the fixture). This adapter then uploads the file, unread,
 * to the health door as `axe-json` for the job's project, commit and branch: the one reader of
 * axe results is the door's `parseAxeResults`, and the score is the door's.
 *
 * ## Asked for and missing is never a pass
 *
 * With the flag off nothing changes. With it on, a Playwright run that otherwise passed is
 * **failed** when the axe pass produced nothing to show: no results file, no project to file it
 * under, or an upload the door refused. The error says which. A run that already ended some other
 * way (failed, timed out, cancelled) keeps its own status; an axe file it did write is still
 * uploaded, since it is evidence about the pages that were visited.
 */

/** Where, relative to the run's workspace, the fixture writes its results. */
export const AXE_RESULTS_NAME = 'reports/axe-results.json';

/** The two variables the Playwright child is given when the job opts in. */
export const AXE_ENVIRONMENT = {
  flag: 'LUPIN_AXE',
  resultsPath: 'LUPIN_AXE_RESULTS_PATH',
} as const;

export interface AxeUpload {
  projectId: string;
  commit?: string | undefined;
  branch?: string | undefined;
  bytes: Uint8Array;
}

/** Sends one axe report to the health door. Throws with a readable reason when refused. */
export type AxeUploader = (upload: AxeUpload) => Promise<void>;

export class AxePassAdapter implements ExecutionProvider {
  constructor(
    private readonly delegate: ExecutionProvider,
    private readonly upload: AxeUploader,
  ) {}

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const result = await this.delegate.execute(context);
    if (context.axe !== true) return result;
    if (!['passed', 'succeeded', 'failed'].includes(result.status)) return result;
    const problem = await this.pass(result.artifacts, context);
    if (problem === undefined || result.status === 'failed') return result;
    return { ...result, status: 'failed', error: problem };
  }

  async cleanup(workspacePath: string): Promise<void> {
    await this.delegate.cleanup?.(workspacePath);
  }

  /** The reason the axe pass has nothing to show, or `undefined` when its report was filed. */
  private async pass(
    artifacts: readonly ExecutionArtifact[],
    context: ExecutionContext,
  ): Promise<{ code: string; message: string } | undefined> {
    const file = artifacts.find((artifact) => artifact.name === AXE_RESULTS_NAME);
    if (file === undefined) {
      return {
        code: 'AXE_NO_RESULTS',
        message:
          'The axe pass was requested but the project wrote no axe results (LUPIN_AXE_RESULTS_PATH); see the repository-health guide for the fixture',
      };
    }
    if (context.projectId === undefined) {
      return {
        code: 'AXE_NO_PROJECT',
        message: 'The axe pass wrote results, but the job names no project to file them under',
      };
    }
    try {
      await this.upload({
        projectId: context.projectId,
        commit: context.commit,
        branch: context.branch,
        bytes: await readFile(file.path),
      });
      return undefined;
    } catch (error) {
      return {
        code: 'AXE_UPLOAD_FAILED',
        message: `The axe results could not be uploaded: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  }
}

const COMMIT = /^[0-9a-f]{7,64}$/iu;

/**
 * The uploader over HTTP: `POST /api/v1/projects/:id/health/reports?format=axe-json`, with
 * `RUNNER_HEALTH_UPLOAD_TOKEN` (an uploader token for the project, or the reporter secret) as the
 * bearer when it is set. Without one the request goes unauthenticated and the door decides; in
 * production it refuses, and the refusal is the run's error.
 */
export function createHealthReportUploader(options: {
  apiUrl: string;
  token?: string | undefined;
  timeoutMs: number;
  fetch?: typeof fetch;
}): AxeUploader {
  const send = options.fetch ?? fetch;
  return async (upload) => {
    const query = new URLSearchParams({ format: 'axe-json' });
    if (upload.commit !== undefined && COMMIT.test(upload.commit))
      query.set('commit', upload.commit);
    if (upload.branch !== undefined && upload.branch.length > 0) query.set('branch', upload.branch);
    const response = await send(
      `${options.apiUrl}/api/v1/projects/${encodeURIComponent(upload.projectId)}/health/reports?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
        },
        body: upload.bytes,
        signal: AbortSignal.timeout(options.timeoutMs),
      },
    );
    if (!response.ok) {
      throw new Error(`the health door answered ${String(response.status)}`);
    }
  };
}
