import type { AiGateway, CompletionInput } from '@lupin/automation';
import type { SettingsService } from '../services/settings-service.js';
import { aiEnvironment } from '../services/settings-testers.js';
import { aiGatewayOrUnconfigured, resolveAiGateway, type GatewayResolution } from './ai-gateway.js';

/**
 * The model provider, decided **per call** from the settings in effect.
 *
 * `resolveAiGateway` used to run once at startup, so a provider saved from the interface did
 * nothing until the API restarted. This keeps the same decision and the same port: each call
 * reads the three AI settings (environment first, then the saved value), and builds a gateway
 * only when that configuration changed since the last call. `decorate` wraps each built
 * gateway with the provider it resolved to, so instrumentation still records the right name.
 *
 * **The chosen model is listed first.** Narration, briefings and test proposals each take the
 * first model the provider lists, so the saved `ai.model` (or `LUPIN_AI_MODEL`) is moved to the
 * front, and every caller uses it without being told about it. A model the provider no longer
 * offers is ignored rather than invented, and choosing one does not rebuild the provider.
 */
export interface LiveAiGateway {
  gateway: AiGateway;
  /** The provider in effect now, or `null` when none is configured. */
  provider(): Promise<'kilo' | 'ollama' | null>;
}

export interface LiveAiGatewayOptions {
  build?: (env: Parameters<typeof resolveAiGateway>[0]) => GatewayResolution;
  decorate?: (gateway: AiGateway, provider: 'kilo' | 'ollama') => AiGateway;
}

const AI_KEYS = ['ai.gatewayUrl', 'ai.apiKey', 'ai.ollamaBaseUrl'] as const;

/** The provider's models, with `chosen` first when the provider offers it. */
export function chosenFirst<T extends { id: string }>(
  models: readonly T[],
  chosen: string | null,
): T[] {
  const index = chosen === null ? -1 : models.findIndex((model) => model.id === chosen);
  if (index <= 0) return [...models];
  return [models[index] as T, ...models.slice(0, index), ...models.slice(index + 1)];
}

export function createLiveAiGateway(
  settings: Pick<SettingsService, 'resolve'>,
  options: LiveAiGatewayOptions = {},
): LiveAiGateway {
  const build = options.build ?? resolveAiGateway;
  let current: { fingerprint: string; resolution: GatewayResolution; gateway: AiGateway } | null =
    null;

  async function resolved() {
    const values: Record<string, Awaited<ReturnType<SettingsService['resolve']>>> = {};
    for (const key of AI_KEYS) values[key] = await settings.resolve(key);
    const env = aiEnvironment(values);
    const fingerprint = JSON.stringify(env);
    if (current?.fingerprint !== fingerprint) {
      const resolution = build(env);
      const base = aiGatewayOrUnconfigured(resolution);
      const gateway =
        resolution.kind === 'none' || options.decorate === undefined
          ? base
          : options.decorate(base, resolution.kind);
      current = { fingerprint, resolution, gateway };
    }
    return current;
  }

  const gateway: AiGateway = {
    listModels: async (signal) => {
      const models = await (await resolved()).gateway.listModels(signal);
      const chosen = await settings.resolve('ai.model');
      return chosenFirst(models, typeof chosen === 'string' && chosen !== '' ? chosen : null);
    },
    streamCompletion: (input: CompletionInput) => ({
      async *[Symbol.asyncIterator]() {
        yield* (await resolved()).gateway.streamCompletion(input);
      },
    }),
  };

  return {
    gateway,
    async provider() {
      const { resolution } = await resolved();
      return resolution.kind === 'none' ? null : resolution.kind;
    },
  };
}
