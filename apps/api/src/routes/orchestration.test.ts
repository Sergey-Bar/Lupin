import { describe, expect, it } from 'vitest';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { Hono } from 'hono';
import { OrchestrationService } from '../services/orchestration-service.js';
import { createOrchestrationRoutes } from './orchestration.js';

describe('orchestration routes', () => {
  it('creates an automation, enqueues a job, and cancels it', async () => {
    const app = withErrorBoundary(new Hono()).route(
      '/',
      createOrchestrationRoutes(new OrchestrationService()),
    );
    const definition = {
      workspaceId: 'workspace-1',
      name: 'Playwright',
      tool: 'playwright' as const,
      toolVersion: '1.63.0',
      imageDigest: 'a'.repeat(64),
      input: {},
      timeoutMs: 1000,
      maxAttempts: 1,
      requiredCapabilities: ['playwright'],
    };
    const created = await app.request('/api/v1/automations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(definition),
    });
    expect(created.status).toBe(201);
    const { automation } = (await created.json()) as { automation: { id: string } };
    const job = await app.request(`/api/v1/automations/${automation.id}/jobs`, { method: 'POST' });
    expect(job.status).toBe(202);
    const { job: envelope } = (await job.json()) as { job: { executionId: string } };
    const cancelled = await app.request(`/api/v1/jobs/${envelope.executionId}/cancel`, {
      method: 'POST',
    });
    expect(cancelled.status).toBe(200);
  });

  it('creates and lists schedules', async () => {
    const app = withErrorBoundary(new Hono()).route(
      '/',
      createOrchestrationRoutes(new OrchestrationService()),
    );
    const schedule = {
      automationId: 'automation-1',
      cron: '0 * * * *',
      timezone: 'UTC',
      enabled: true,
      misfirePolicy: 'run_once' as const,
    };
    expect(
      (
        await app.request('/api/v1/schedules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(schedule),
        })
      ).status,
    ).toBe(201);
    const listed = await app.request('/api/v1/schedules');
    expect(listed.status).toBe(200);
    // It used to answer a literal empty list whatever POST had stored (ledger MNT-176).
    expect(((await listed.json()) as { schedules: unknown[] }).schedules).toHaveLength(1);
    expect((await app.request('/api/v1/schedules', { method: 'POST', body: '{}' })).status).toBe(
      400,
    );
    expect((await app.request('/api/v1/automations', { method: 'POST', body: '{}' })).status).toBe(
      400,
    );
    expect((await app.request('/api/v1/automations/missing/jobs', { method: 'POST' })).status).toBe(
      404,
    );
    expect((await app.request('/api/v1/jobs/missing/cancel', { method: 'POST' })).status).toBe(404);
  });
});
