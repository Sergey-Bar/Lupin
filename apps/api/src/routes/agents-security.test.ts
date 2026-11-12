import { describe, expect, it } from 'vitest';
import { AgentAcceptedRunSchema } from '@lupin/shared-contracts';
import { createToolRegistry } from '@lupin/tool-sdk';
import { registerSecurityAgent } from '../agents/security-adapter.js';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import { createAgentCatalog } from './agent-registry.js';
import { createAgentRoutes } from './agents.js';
import { createHealthRoutes } from './health.js';

const VALID = { targetUrl: 'http://127.0.0.1:3000' };

function compose(store = new InMemoryExecutionStore()) {
  const registry = createToolRegistry();
  registerSecurityAgent({ registry, store, workspaceId: 'ws-a', requireIdempotencyKey: false });
  return { store, registry, agents: createAgentRoutes({ registry }) };
}

function post(app: ReturnType<typeof compose>['agents'], path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/agents/security/scan', () => {
  it('answers 202 with a Location, and queues a job that needs the zap capability', async () => {
    const { agents, store } = compose();
    const response = await post(agents, '/api/v1/agents/security/scan', VALID);
    expect(response.status).toBe(202);
    const accepted = AgentAcceptedRunSchema.parse(await response.json());
    expect(accepted.domain).toBe('security');
    expect(response.headers.get('location')).toBe(`/api/v1/runs/${accepted.runId}`);
    expect(await store.getJob(accepted.jobId, 'ws-a')).toMatchObject({
      state: 'queued',
      requiredCapabilities: ['zap'],
    });
  });

  it.each([
    ['no target', {}],
    ['a target with credentials', { targetUrl: 'https://u:p@host.test/' }],
    ['a non-http target', { targetUrl: 'ftp://host.test/' }],
  ])('refuses %s with the 400 body shape and queues nothing', async (_name, body) => {
    const { agents, store } = compose();
    const response = await post(agents, '/api/v1/agents/security/scan', body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: 'invalid_input',
      code: 'AGENT_INVALID_INPUT',
      domain: 'security',
      action: 'scan',
    });
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);
  });

  it('keeps run and generate at 501, saying why', async () => {
    const { agents } = compose();
    for (const action of ['run', 'generate']) {
      const response = await post(agents, `/api/v1/agents/security/${action}`, VALID);
      expect(response.status).toBe(501);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ code: 'AGENT_NOT_CONFIGURED', domain: 'security', action });
      expect(String(body['reason']).length).toBeGreaterThan(20);
    }
  });

  it('reports security configured with scan only, and agent.security true', async () => {
    const { agents, registry } = compose();
    const listing = (await (await agents.request('/api/v1/agents')).json()) as {
      integrations: Array<{ domain: string }>;
    };
    expect(listing.integrations.find((item) => item.domain === 'security')).toEqual({
      domain: 'security',
      status: 'configured',
      implemented: true,
      actions: ['scan'],
    });
    const health = createHealthRoutes({
      agentAvailability: createAgentCatalog(registry).available,
    });
    const body = (await (await health.request('/api/v1/features')).json()) as {
      features: Record<string, boolean>;
    };
    expect(body.features['agent.security']).toBe(true);
  });
});
