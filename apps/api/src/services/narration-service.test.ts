import { describe, expect, it } from 'vitest';
import type { AiGateway, CompletionInput } from '@lupin/automation';
import { composeBriefing } from '@lupin/reporting';
import {
  NARRATION_TTL_MS,
  createNarrator,
  narrationPrompt,
  validateNarration,
} from './narration-service.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const PROJECT = '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11';

const briefing = composeBriefing({
  scope: { kind: 'repository', projectId: PROJECT, name: 'Shop' },
  now: NOW,
  windowDays: 7,
  merged: { total: 14, ai: 9, highRisk: 2, unreviewedAi: 2, tampered: 0 },
  deployments: 3,
  pace: { changedLines: 4200, testsPerKloc: 1.5, debt: 1240, unmeasured: 0 },
  bottlenecks: [],
  quality: null,
  decisions: [],
});

const answer = (sentences: Array<{ text: string; cites: string[] }>) =>
  JSON.stringify({ sentences });

function gateway(text: string, seen: CompletionInput[] = []): AiGateway {
  return {
    listModels: async () => [{ id: 'model-a' } as never],
    streamCompletion: (input) => {
      seen.push(input);
      return (async function* () {
        yield { type: 'text' as const, text };
        yield { type: 'done' as const };
      })() as never;
    },
  };
}

describe('validateNarration', () => {
  it('accepts sentences that cite real items and use only their numbers', () => {
    const result = validateNarration(
      briefing,
      answer([
        {
          text: 'Fourteen changes merged this week, 9 of them written by AI.',
          cites: ['shipped.merged'],
        },
        { text: 'Two went in at high risk.', cites: ['riskier.high-risk'] },
        {
          text: 'About 4,200 lines changed and 1,240 of them merged untested.',
          cites: ['shape.pace'],
        },
      ]),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses a number the cited items never said', () => {
    const result = validateNarration(
      briefing,
      answer([{ text: '15 pull requests merged.', cites: ['shipped.merged'] }]),
    );
    expect(result).toEqual({
      ok: false,
      reason: 'Sentence 1 uses 15, which none of the items it cites says.',
    });
  });

  it('refuses a citation of an item that is not there, and a sentence that cites nothing', () => {
    expect(
      validateNarration(briefing, answer([{ text: 'All good.', cites: ['shape.vibes'] }])),
    ).toEqual({ ok: false, reason: 'Sentence 1 cites shape.vibes, which is not in the briefing.' });
    expect(validateNarration(briefing, answer([{ text: 'All good.', cites: [] }]))).toMatchObject({
      ok: false,
    });
  });

  it('refuses an answer that is not the JSON asked for, and reads one inside a code fence', () => {
    expect(validateNarration(briefing, 'Here is a summary of your week!')).toEqual({
      ok: false,
      reason: 'The model did not answer with the JSON it was asked for.',
    });
    const fenced = `\`\`\`json\n${answer([{ text: '3 deployments shipped.', cites: ['shipped.deployments'] }])}\n\`\`\``;
    expect(validateNarration(briefing, fenced)).toMatchObject({ ok: true });
  });
});

describe('narrationPrompt', () => {
  it('sends the items’ ids, sections and sentences, and nothing the briefing did not hold', () => {
    const messages = narrationPrompt(briefing);
    const user = messages.find((message) => message.role === 'user')?.content ?? '';
    expect(user).toContain('"id":"shipped.merged"');
    expect(user).not.toContain('evidence');
    expect(messages[0]?.content).toMatch(/only the numbers/u);
  });
});

describe('createNarrator', () => {
  it('says it is unavailable with no model configured', async () => {
    const narrator = createNarrator({ gateway: null, now: () => NOW });
    expect(await narrator.narrate(briefing)).toEqual({
      status: 'unavailable',
      reason: 'No model provider is configured; the briefing stands as written.',
    });
  });

  it('accepts a narration that passes, and serves it from memory until it expires', async () => {
    const seen: CompletionInput[] = [];
    let clock = NOW.getTime();
    const narrator = createNarrator({
      gateway: gateway(answer([{ text: '14 merged.', cites: ['shipped.merged'] }]), seen),
      now: () => new Date(clock),
    });
    expect(await narrator.narrate(briefing)).toMatchObject({
      status: 'accepted',
      model: 'model-a',
    });
    await narrator.narrate(briefing);
    expect(seen).toHaveLength(1);
    clock += NARRATION_TTL_MS + 1;
    await narrator.narrate(briefing);
    expect(seen).toHaveLength(2);
  });

  it('throws away a narration that invents a number, and says why', async () => {
    const narrator = createNarrator({
      gateway: gateway(answer([{ text: '99 merged.', cites: ['shipped.merged'] }])),
      now: () => NOW,
    });
    expect(await narrator.narrate(briefing)).toEqual({
      status: 'rejected',
      model: 'model-a',
      reason: 'Sentence 1 uses 99, which none of the items it cites says.',
    });
  });

  it('says it is unavailable when the model fails, rather than failing the briefing', async () => {
    const failing: AiGateway = {
      listModels: async () => [{ id: 'model-a' } as never],
      streamCompletion: () =>
        ({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new Error('provider down')),
          }),
        }) as never,
    };
    const narrator = createNarrator({ gateway: failing, now: () => NOW });
    expect(await narrator.narrate(briefing)).toEqual({
      status: 'unavailable',
      reason: 'The model could not be reached: provider down',
    });
  });
});
