/**
 * The copilot in the configured model's words, held to the rule engine's evidence.
 *
 * The model is asked only to rephrase what the rule engine already established. Its answer is
 * kept when every number in it appears in that evidence; one invented number and the
 * copilot answers with the rules instead. No model, a failing one, or an empty answer: the
 * rules, so the copilot always says something true.
 */
import type { AiGateway } from '@lupin/automation';

export interface Grounding {
  summary: string;
  facts: string[];
}

export type Narration =
  { source: 'model'; model: string; text: string } | { source: 'rules'; text: string };

/** Longest answer kept from a model; anything longer is treated as unusable. */
const MAX_TEXT = 1_200;
const TIMEOUT_MS = 8_000;

function numbersIn(text: string): string[] {
  return text.match(/[\d.]+/gu) ?? [];
}

export async function narrate(
  grounding: Grounding,
  gateway: AiGateway | undefined,
): Promise<Narration> {
  const rules: Narration = { source: 'rules', text: grounding.summary };
  if (gateway === undefined) return rules;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const model = (await gateway.listModels(controller.signal))[0]?.id;
    if (model === undefined) return rules;
    let text = '';
    for await (const chunk of gateway.streamCompletion({
      model,
      signal: controller.signal,
      messages: [
        {
          role: 'system',
          content:
            'You explain test results to a QA engineer in two short sentences. Use only the facts given. ' +
            'Do not add any number, test, cause or recommendation that is not in them.',
        },
        { role: 'user', content: `Facts:\n- ${grounding.facts.join('\n- ')}` },
      ],
    })) {
      if (chunk.type === 'text') text += chunk.text;
      if (text.length > MAX_TEXT) return rules;
    }
    text = text.trim();
    if (text === '') return rules;
    const allowed = new Set(numbersIn([grounding.summary, ...grounding.facts].join(' ')));
    if (numbersIn(text).some((number) => !allowed.has(number))) return rules;
    return { source: 'model', model, text };
  } catch {
    return rules;
  } finally {
    clearTimeout(timer);
  }
}
