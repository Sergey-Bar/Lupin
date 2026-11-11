import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { createErrorBoundary } from '../errors/boundary.js';
import type { ExecutionRun, ExecutionStore } from '../execution/types.js';
import { createCopilotRoutes } from './routes.js';

function failedRun(id: string): ExecutionRun {
  return {
    id,
    outcome: 'failed',
    phase: 'complete',
    branch: 'main',
    tests: [
      {
        id: 't1',
        title: 'checkout pays',
        file: 'e2e/checkout.spec.ts',
        status: 'failed',
        durationMs: 10,
        error: { code: 'ASSERTION_FAILED', message: 'expected 200, got 500' },
      },
    ],
    summary: {
      total: 1,
      passed: 0,
      failed: 1,
      flaky: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: null,
    },
  } as ExecutionRun;
}

/** Two workspaces, one run each; the store answers only for the run's own workspace. */
function harness(workspaceId: string) {
  const runs = new Map([
    ['ws-a', failedRun('run-a')],
    ['ws-b', failedRun('run-b')],
  ]);
  const store = {
    listRuns: async (ws?: string) => {
      const run = ws === undefined ? undefined : runs.get(ws);
      return { runs: run === undefined ? [] : [run], hasMore: false };
    },
    getRun: async (runId: string, ws?: string) => {
      const run = ws === undefined ? undefined : runs.get(ws);
      return run?.id === runId ? run : null;
    },
  } as unknown as ExecutionStore;
  const boundary = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'req-test',
  });
  const app = withErrorBoundary(new Hono());
  app.onError(boundary.onError);
  app.notFound(boundary.notFound);
  app.route('/', createCopilotRoutes({ store, workspaceId }));
  return app;
}

function explain(app: Hono, body: unknown) {
  return app.request('/api/v1/copilot/explain', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/copilot/explain', () => {
  it('explains a run in the caller workspace, citing its failing test', async () => {
    const response = await explain(harness('ws-a'), { runId: 'run-a' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { runId: string; causes: unknown[] };
    expect(body.runId).toBe('run-a');
    expect(JSON.stringify(body)).toContain('t1');
  });

  it('answers 404 for a run in another workspace, the same as a missing one', async () => {
    const foreign = await explain(harness('ws-a'), { runId: 'run-b' });
    const missing = await explain(harness('ws-a'), { runId: 'nope' });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it('refuses a body without a run id', async () => {
    const response = await explain(harness('ws-a'), {});
    expect(response.status).toBe(422);
  });
});

describe('POST /api/v1/copilot/ask', () => {
  function ask(app: Hono, body: unknown) {
    return app.request('/api/v1/copilot/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('answers from the caller workspace runs only', async () => {
    const response = await ask(harness('ws-a'), { question: 'what is failing?' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { citations: Array<{ id: string }> };
    const cited = body.citations.map((citation) => citation.id);
    expect(cited).toContain('run-a');
    expect(cited).not.toContain('run-b');
  });

  it('refuses an empty or oversized question', async () => {
    expect((await ask(harness('ws-a'), { question: '' })).status).toBe(422);
    expect((await ask(harness('ws-a'), { question: 'x'.repeat(501) })).status).toBe(422);
  });
});

describe('POST /api/v1/copilot/explain owners', () => {
  it('names the owner of each cause from the run project, asking only for that project', async () => {
    const asked: string[] = [];
    const run = { ...failedRun('run-a'), projectId: 'p-a' } as ExecutionRun;
    const store = {
      getRun: async (id: string, ws?: string) => (ws === 'ws-a' && id === 'run-a' ? run : null),
    } as unknown as ExecutionStore;
    const app = withErrorBoundary(new Hono());
    app.route(
      '/',
      createCopilotRoutes({
        store,
        workspaceId: 'ws-a',
        ownersFor: async (projectId) => {
          asked.push(projectId);
          return (file) => (file === 'e2e/checkout.spec.ts' ? '@checkout-team' : null);
        },
      }),
    );
    const response = await explain(app, { runId: 'run-a' });
    const body = (await response.json()) as { causes: Array<{ owners: string[] }> };
    expect(body.causes[0]?.owners).toEqual(['@checkout-team']);
    expect(asked).toEqual(['p-a']);
  });

  it('still explains, with no owners, when the owner lookup fails', async () => {
    const run = { ...failedRun('run-a'), projectId: 'p-a' } as ExecutionRun;
    const store = { getRun: async () => run } as unknown as ExecutionStore;
    const app = withErrorBoundary(new Hono());
    app.route(
      '/',
      createCopilotRoutes({
        store,
        workspaceId: 'ws-a',
        ownersFor: async () => {
          throw new Error('db down');
        },
      }),
    );
    const response = await explain(app, { runId: 'run-a' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { causes: Array<{ owners: string[] }> };
    expect(body.causes[0]?.owners).toEqual([]);
  });
});
