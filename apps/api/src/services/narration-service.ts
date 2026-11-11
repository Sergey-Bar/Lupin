import { createHash } from 'node:crypto';
import type { AiGateway, CompletionInput } from '@lupin/automation';
import {
  NarrationSchema,
  type Briefing,
  type BriefingResponse,
  type Narration,
} from '@lupin/shared-contracts';

/**
 * Optional prose for a briefing, held to the briefing.
 *
 * The model is sent the briefing's items — their ids, sections and sentences — and nothing else:
 * no source, no diff, no evidence paths, no names beyond what the items already say. It must
 * answer with sentences that each cite the items they reword, and {@link validateNarration}
 * throws the whole narration away if a sentence cites nothing, cites an item that is not there,
 * or uses a number none of its cited items says. A thrown-away narration is reported with its
 * reason, and the briefing's own items stand.
 *
 * Neither the prompt nor the answer is stored. An accepted narration is kept in memory for
 * {@link NARRATION_TTL_MS}, keyed on the briefing's content, so one briefing costs one completion.
 */

export const NARRATION_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 200;
const TIMEOUT_MS = 60_000;
type Messages = CompletionInput['messages'];
type NarrationResult = NonNullable<BriefingResponse['narration']>;

export function narrationPrompt(briefing: Briefing): Messages {
  const items = briefing.items.map((item) => ({
    id: item.id,
    section: item.section,
    tone: item.tone,
    text: item.text,
  }));
  return [
    {
      role: 'system',
      content: [
        'You rewrite a software quality briefing as a few plain sentences for a QA lead.',
        'Answer with JSON only: {"sentences":[{"text":"...","cites":["item.id"]}]}.',
        'Every sentence cites the ids of the items it rewords. Use only the numbers those items state.',
        'Do not add advice, causes or facts the items do not state. At most six sentences, worst news first.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Briefing over ${String(briefing.windowDays)} days:\n${JSON.stringify(items)}`,
    },
  ];
}

/** The numbers a text states, commas dropped: "4,200" and "4200" are one number. */
function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d.,]*/gu)].map((match) =>
    match[0].replace(/[.,]+$/u, '').replaceAll(',', ''),
  );
}

function jsonOf(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(raw);
  try {
    return JSON.parse((fenced?.[1] ?? raw).trim()) as unknown;
  } catch {
    return null;
  }
}

export function validateNarration(
  briefing: Briefing,
  raw: string,
): { ok: true; narration: Narration } | { ok: false; reason: string } {
  const parsed = NarrationSchema.safeParse(jsonOf(raw));
  if (!parsed.success) {
    return { ok: false, reason: 'The model did not answer with the JSON it was asked for.' };
  }
  const byId = new Map(briefing.items.map((item) => [item.id, item]));
  for (const [index, sentence] of parsed.data.sentences.entries()) {
    const which = `Sentence ${String(index + 1)}`;
    const unknown = sentence.cites.find((id) => !byId.has(id));
    if (unknown !== undefined) {
      return { ok: false, reason: `${which} cites ${unknown}, which is not in the briefing.` };
    }
    const stated = new Set(sentence.cites.flatMap((id) => numbersIn(byId.get(id)?.text ?? '')));
    const invented = numbersIn(sentence.text).find((number) => !stated.has(number));
    if (invented !== undefined) {
      return {
        ok: false,
        reason: `${which} uses ${invented}, which none of the items it cites says.`,
      };
    }
  }
  return { ok: true, narration: parsed.data };
}

async function complete(gateway: AiGateway, model: string, messages: Messages): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let text = '';
  for await (const chunk of gateway.streamCompletion({
    model,
    messages,
    signal,
  } as CompletionInput)) {
    if (chunk.type === 'text') text += chunk.text;
  }
  return text;
}

export interface Narrator {
  narrate(briefing: Briefing): Promise<NarrationResult>;
}

/** A narrator over one gateway, with its own short in-memory cache. */
export function createNarrator(options: {
  gateway: AiGateway | null;
  model?: string | undefined;
  now?: () => Date;
}): Narrator {
  const cache = new Map<string, { at: number; result: NarrationResult }>();
  const now = () => (options.now?.() ?? new Date()).getTime();
  return {
    async narrate(briefing) {
      const gateway = options.gateway;
      if (gateway === null) {
        return {
          status: 'unavailable',
          reason: 'No model provider is configured; the briefing stands as written.',
        };
      }
      // The briefing minus its clock: the same counts narrate the same way.
      const key = createHash('sha256')
        .update(JSON.stringify({ ...briefing, generatedAt: null }))
        .digest('hex');
      const cached = cache.get(key);
      if (cached !== undefined && now() - cached.at < NARRATION_TTL_MS) return cached.result;
      let result: NarrationResult;
      try {
        const model = options.model ?? (await gateway.listModels())[0]?.id;
        if (model === undefined)
          return { status: 'unavailable', reason: 'The provider lists no model.' };
        const checked = validateNarration(
          briefing,
          await complete(gateway, model, narrationPrompt(briefing)),
        );
        result = checked.ok
          ? { status: 'accepted', model, narration: checked.narration }
          : { status: 'rejected', model, reason: checked.reason };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          status: 'unavailable',
          reason: `The model could not be reached: ${reason}`.slice(0, 300),
        };
      }
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: now(), result });
      return result;
    },
  };
}
