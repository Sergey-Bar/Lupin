import { describe, expect, it } from 'vitest';
import {
  AgentAcceptedRunSchema,
  ZAP_DEFAULT_SPIDER_MINUTES,
  ZAP_MAX_SPIDER_MINUTES,
} from '@lupin/shared-contracts';
import { createToolRegistry, toAgentProblem, type ToolRegistry } from '@lupin/tool-sdk';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import type { ExecutionStore } from '../execution/types.js';
import { DomainError } from '../errors/domain-error.js';
import {
  SECURITY_TIMEOUT_GRACE_MS,
  SECURITY_UNSUPPORTED_REASONS,
  registerSecurityAgent,
} from './security-adapter.js';

const VALID = { targetUrl: 'http://127.0.0.1:3000' };

function compose(
  overrides: { store?: ExecutionStore; workspaceId?: string; requireIdempotencyKey?: boolean } = {},
): { registry: ToolRegistry; store: ExecutionStore } {
  const store = overrides.store ?? new InMemoryExecutionStore();
  const registry = createToolRegistry();
  registerSecurityAgent({
    registry,
    store,
    workspaceId: overrides.workspaceId ?? 'ws-a',
    requireIdempotencyKey: overrides.requireIdempotencyKey ?? false,
  });
  return { registry, store };
}

async function failureOf(registry: ToolRegistry, domain: string, action: string, input: unknown) {
  const result = await registry.dispatch(domain, action, input);
  if (result.ok) throw new Error(`${domain}.${action} unexpectedly succeeded`);
  return result.failure;
}

describe('security.scan', () => {
  it('is the only security pair registered: run and generate stay unconfigured', () => {
    const { registry } = compose();
    expect(registry.has('security', 'scan')).toBe(true);
    expect(registry.has('security', 'run')).toBe(false);
    expect(registry.has('security', 'generate')).toBe(false);
    expect(registry.configuredDomains()).toEqual(['security']);
  });

  it('queues a ZAP baseline job with the default made explicit, and answers with its ids', async () => {
    const { registry, store } = compose();
    const result = await registry.dispatch('security', 'scan', {
      ...VALID,
      branch: 'feat/x',
      commit: 'abc123',
    });
    if (!result.ok) throw new Error(result.failure.message);

    const accepted = AgentAcceptedRunSchema.parse(result.value);
    expect(accepted).toMatchObject({
      status: 'accepted',
      domain: 'security',
      action: 'scan',
      phase: 'queued',
      duplicate: false,
    });
    const run = await store.getRun(accepted.runId, 'ws-a');
    expect(run).toMatchObject({
      framework: 'zap',
      testType: 'security',
      branch: 'feat/x',
      commit: 'abc123',
      requiredCapabilities: ['zap'],
      timeoutMs: ZAP_DEFAULT_SPIDER_MINUTES * 60_000 + SECURITY_TIMEOUT_GRACE_MS,
    });
    // What the runner reads: a baseline scan, its bound and the target, nothing else.
    expect(run?.configuration).toEqual({
      zap: { scan: 'baseline', spiderMinutes: ZAP_DEFAULT_SPIDER_MINUTES },
      targetUrl: 'http://127.0.0.1:3000',
    });
    expect(await store.getJob(accepted.jobId, 'ws-a')).toMatchObject({
      state: 'queued',
      requiredCapabilities: ['zap'],
    });
  });

  it('derives the job timeout from the spider minutes', async () => {
    const { registry, store } = compose();
    const result = await registry.dispatch('security', 'scan', {
      ...VALID,
      spiderMinutes: ZAP_MAX_SPIDER_MINUTES,
    });
    if (!result.ok) throw new Error(result.failure.message);
    const run = await store.getRun(AgentAcceptedRunSchema.parse(result.value).runId, 'ws-a');
    expect(run?.timeoutMs).toBe(ZAP_MAX_SPIDER_MINUTES * 60_000 + SECURITY_TIMEOUT_GRACE_MS);
  });

  it('is idempotent on the key, and demands one when the runs API would', async () => {
    const { registry, store } = compose();
    const input = { ...VALID, idempotencyKey: 'same-key' };
    const first = await registry.dispatch('security', 'scan', input);
    const second = await registry.dispatch('security', 'scan', input);
    if (!first.ok || !second.ok) throw new Error('both dispatches must be accepted');
    expect(AgentAcceptedRunSchema.parse(second.value)).toMatchObject({
      runId: AgentAcceptedRunSchema.parse(first.value).runId,
      duplicate: true,
    });
    expect((await store.listRuns('ws-a')).runs).toHaveLength(1);

    const strict = compose({ requireIdempotencyKey: true });
    expect(await failureOf(strict.registry, 'security', 'scan', VALID)).toMatchObject({
      kind: 'invalid_input',
    });
  });

  it.each([
    ['a missing target', {}],
    ['a file: target', { targetUrl: 'file:///etc/passwd' }],
    ['a target with credentials', { targetUrl: 'http://u:p@host.test/' }],
    ['a javascript: target', { targetUrl: 'javascript:alert(1)' }],
    ['too many spider minutes', { ...VALID, spiderMinutes: ZAP_MAX_SPIDER_MINUTES + 1 }],
    ['an active scan', { ...VALID, scan: 'full' }],
    ['an arbitrary command', { ...VALID, command: ['zap.sh', '-cmd'] }],
    ['a caller-chosen timeout', { ...VALID, timeoutMs: 1 }],
    ['no input at all', undefined],
  ])('refuses %s with a 400 and creates nothing', async (_name, input) => {
    const { registry, store } = compose();
    const failure = await failureOf(registry, 'security', 'scan', input);
    expect(failure).toMatchObject({ kind: 'invalid_input', code: 'AGENT_INVALID_INPUT' });
    expect(toAgentProblem(failure).httpStatus).toBe(400);
    expect((await store.listRuns('ws-a')).runs).toHaveLength(0);
  });

  it('reports a store refusal as a 400 and an outage without its message', async () => {
    const refusing = new InMemoryExecutionStore();
    refusing.createRun = () =>
      Promise.reject(new DomainError('INVALID_RUN', 'projectId is unknown'));
    expect(
      await failureOf(compose({ store: refusing }).registry, 'security', 'scan', VALID),
    ).toMatchObject({ kind: 'invalid_input', message: 'projectId is unknown' });

    const down = new InMemoryExecutionStore();
    down.createRun = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const failure = await failureOf(compose({ store: down }).registry, 'security', 'scan', VALID);
    expect(failure.kind).toBe('tool_failure');
    expect(failure.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });
});

describe('security.run and security.generate', () => {
  it('state why they are not supported, and are refused with a 501', async () => {
    expect(SECURITY_UNSUPPORTED_REASONS['run']).toMatch(/active scan/i);
    expect(SECURITY_UNSUPPORTED_REASONS['generate']).toMatch(/gateway/i);
    const { registry } = compose();
    for (const action of ['run', 'generate']) {
      const failure = await failureOf(registry, 'security', action, VALID);
      expect(toAgentProblem(failure).httpStatus).toBe(501);
    }
  });
});

describe('workspace isolation', () => {
  it('a scan accepted for one workspace is invisible to another over the same store', async () => {
    const store = new InMemoryExecutionStore();
    const a = compose({ store, workspaceId: 'ws-a' });
    const result = await a.registry.dispatch('security', 'scan', VALID);
    if (!result.ok) throw new Error(result.failure.message);
    const accepted = AgentAcceptedRunSchema.parse(result.value);
    expect(await store.getRun(accepted.runId, 'ws-a')).not.toBeNull();
    expect(await store.getRun(accepted.runId, 'ws-b')).toBeNull();
    expect(await store.getJob(accepted.jobId, 'ws-b')).toBeNull();
    expect((await store.listRuns('ws-b')).runs).toEqual([]);
  });
});
