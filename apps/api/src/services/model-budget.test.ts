import { afterEach, describe, expect, it } from 'vitest';
import type { AiGateway } from '@lupin/automation';
import { migratedDatabase } from '../test-support/migrated-database.js';
import {
  budgetedGateway,
  monthlyTokenBudgetFrom,
  recordSelfSpan,
  selfTokensThisMonth,
} from './genai-span-service.js';

/** This install's own model calls stop at a monthly token budget (plan task 36). */
const NOW = new Date('2026-11-12T12:00:00.000Z');
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const answering: AiGateway = {
  listModels: async () => [{ id: 'm' }],
  streamCompletion: async function* () {
    yield { type: 'text', text: 'ok' };
    yield { type: 'done', finishReason: 'stop' };
  },
} as unknown as AiGateway;

async function drain(gateway: AiGateway): Promise<string> {
  let text = '';
  for await (const chunk of gateway.streamCompletion({ model: 'm', messages: [] })) {
    if (chunk.type === 'text') text += chunk.text;
  }
  return text;
}

async function span(
  options: { db: never; workspaceId: string; now: () => Date },
  at: string,
  tokens: number,
) {
  await recordSelfSpan(options, {
    traceId: `t-${at}-${String(tokens)}`,
    spanId: `s-${at}-${String(tokens)}`,
    operation: 'chat',
    provider: 'p',
    requestModel: 'm',
    responseModel: 'm',
    inputTokens: tokens,
    outputTokens: 0,
    startedAt: at,
    durationMs: 1,
    status: 'ok',
    errorType: null,
  } as never);
}

describe('the monthly model budget', () => {
  it('counts only this month, then refuses a completion once spent', async () => {
    const { db, close } = await migratedDatabase();
    closers.push(close);
    const options = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
    await span(options, '2026-10-30T00:00:00.000Z', 900);
    await span(options, '2026-11-02T00:00:00.000Z', 600);
    expect(await selfTokensThisMonth(options)).toBe(600);
    expect(await drain(budgetedGateway(options, answering, 1000))).toBe('ok');
    await span(options, '2026-11-10T00:00:00.000Z', 400);
    await expect(drain(budgetedGateway(options, answering, 1000))).rejects.toMatchObject({
      code: 'BUDGET_EXHAUSTED',
    });
    // Listing models is never refused, and no budget changes nothing.
    expect(await budgetedGateway(options, answering, 1000).listModels()).toHaveLength(1);
    expect(budgetedGateway(options, answering, null)).toBe(answering);
  });

  it('reads the budget from the environment', () => {
    expect(monthlyTokenBudgetFrom(undefined)).toBeNull();
    expect(monthlyTokenBudgetFrom('500000')).toBe(500000);
    expect(() => monthlyTokenBudgetFrom('0')).toThrow(/LUPIN_AI_MONTHLY_TOKEN_BUDGET/);
  });
});
