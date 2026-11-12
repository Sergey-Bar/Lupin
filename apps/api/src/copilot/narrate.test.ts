import { describe, expect, it } from 'vitest';
import type { AiGateway, CompletionChunk } from '@lupin/automation';
import { narrate } from './narrate.js';

function gateway(text: string | Error, models = [{ id: 'm1', gateway: 'test' }]): AiGateway {
  return {
    listModels: async () => {
      if (text instanceof Error) throw text;
      return models;
    },
    async *streamCompletion(): AsyncIterable<CompletionChunk> {
      if (text instanceof Error) throw text;
      yield { type: 'text', text };
      yield { type: 'done', finishReason: 'stop' };
    },
  };
}

const RULES = {
  summary: '2 of 4 tests failed on main, from 1 cause.',
  facts: ['2 of 4 tests failed', 'branch main', '1 cause: expected 200, got 500'],
};

describe('narrate', () => {
  it('uses the model when every number it states is in the evidence', async () => {
    const text = 'On main, 2 of 4 tests failed, all from 1 cause: a 500 where 200 was expected.';
    expect(await narrate(RULES, gateway(text))).toEqual({ source: 'model', model: 'm1', text });
  });

  it('falls back to the rules when the model states a number the evidence does not hold', async () => {
    expect(await narrate(RULES, gateway('3 of 4 tests failed on main.'))).toEqual({
      source: 'rules',
      text: RULES.summary,
    });
  });

  it('falls back to the rules when no model is configured, none is listed, or it fails', async () => {
    const rules = { source: 'rules', text: RULES.summary };
    expect(await narrate(RULES, gateway(new Error('unconfigured')))).toEqual(rules);
    expect(await narrate(RULES, gateway('ok', []))).toEqual(rules);
    expect(await narrate(RULES, undefined)).toEqual(rules);
  });

  it('falls back to the rules on an empty answer', async () => {
    expect((await narrate(RULES, gateway('   '))).source).toBe('rules');
  });
});
