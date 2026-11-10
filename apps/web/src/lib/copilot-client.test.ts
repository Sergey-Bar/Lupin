import { describe, expect, it, vi } from 'vitest';
import { createCopilotClient } from './copilot-client.js';

const ANSWER = {
  runId: 'run-1',
  source: 'rules',
  summary: '1 of 2 tests failed.',
  causes: [{ message: 'expected 200, got 500', count: 1, tests: ['t1'] }],
  citations: [
    { kind: 'run', id: 'run-1' },
    { kind: 'test', id: 't1', runId: 'run-1' },
  ],
  actions: [{ kind: 'retry', runId: 'run-1', scope: 'failed', label: 'Retry the failed test' }],
};

function respond(body: unknown, status = 200) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

describe('copilot client', () => {
  it('posts the run id and parses the explanation', async () => {
    const fetchImpl = respond(ANSWER);
    const answer = await createCopilotClient('', fetchImpl).explainRun('run-1');
    expect(answer.summary).toBe('1 of 2 tests failed.');
    expect(answer.citations).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/copilot/explain');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ runId: 'run-1' });
  });

  it('refuses an answer that does not match the contract', async () => {
    const fetchImpl = respond({ ...ANSWER, causes: 'none' });
    await expect(createCopilotClient('', fetchImpl).explainRun('run-1')).rejects.toThrow();
  });

  it('surfaces a 404 as an error', async () => {
    const fetchImpl = respond({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found' } }, 404);
    await expect(createCopilotClient('', fetchImpl).explainRun('x')).rejects.toThrow();
  });
});
