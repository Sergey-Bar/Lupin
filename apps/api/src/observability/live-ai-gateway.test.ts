import { describe, expect, it, vi } from 'vitest';
import type { AiGateway } from '@lupin/automation';
import { createSettingsService } from '../services/settings-service.js';
import { resolveAiGateway } from './ai-gateway.js';
import { createLiveAiGateway } from './live-ai-gateway.js';

/** A settings service whose saved values are a plain map, so the test needs no database. */
function memorySettings(saved: Record<string, string>) {
  const base = createSettingsService({ workspaceId: 'ws-1', env: {} });
  return { ...base, resolve: async (key: string) => saved[key] ?? (await base.resolve(key)) };
}

const stub = (id: string): AiGateway => ({
  listModels: async () => [{ id, gateway: 'ollama' }] as never,
  streamCompletion: () => ({ async *[Symbol.asyncIterator]() {} }) as never,
});

describe('the live AI gateway', () => {
  it('lists the saved model first, so every caller that takes the first model uses it', async () => {
    const saved: Record<string, string> = { 'ai.ollamaBaseUrl': 'http://a:1' };
    const two: AiGateway = {
      ...stub('x'),
      listModels: async () => [{ id: 'llama3.1:8b' }, { id: 'qwen2.5-coder:7b' }] as never,
    };
    const build = vi.fn(() => ({ kind: 'ollama' as const, gateway: two }));
    const live = createLiveAiGateway(memorySettings(saved), { build });
    const ids = async () => (await live.gateway.listModels()).map((model) => model.id);
    expect(await ids()).toEqual(['llama3.1:8b', 'qwen2.5-coder:7b']);
    saved['ai.model'] = 'qwen2.5-coder:7b';
    expect(await ids()).toEqual(['qwen2.5-coder:7b', 'llama3.1:8b']);
    // Choosing a model is not a new provider: the gateway is not rebuilt for it.
    expect(build).toHaveBeenCalledTimes(1);
    // A model the provider no longer offers is not invented; the provider's own order stands.
    saved['ai.model'] = 'gone:1b';
    expect(await ids()).toEqual(['llama3.1:8b', 'qwen2.5-coder:7b']);
  });

  it('uses a provider saved after startup, without a restart', async () => {
    const saved: Record<string, string> = {};
    const build = vi.fn((env: Parameters<typeof resolveAiGateway>[0]) =>
      env?.OLLAMA_BASE_URL
        ? { kind: 'ollama' as const, gateway: stub(env.OLLAMA_BASE_URL) }
        : resolveAiGateway(env),
    );
    const live = createLiveAiGateway(memorySettings(saved), { build });
    await expect(live.gateway.listModels()).rejects.toThrow('no model provider is configured');
    saved['ai.ollamaBaseUrl'] = 'http://ollama:11434';
    expect(await live.gateway.listModels()).toEqual([
      { id: 'http://ollama:11434', gateway: 'ollama' },
    ]);
    expect(await live.provider()).toBe('ollama');
  });

  it('builds a gateway once per configuration, and again when it changes', async () => {
    const saved: Record<string, string> = { 'ai.ollamaBaseUrl': 'http://a:1' };
    const build = vi.fn((env: Parameters<typeof resolveAiGateway>[0]) => ({
      kind: 'ollama' as const,
      gateway: stub(env?.OLLAMA_BASE_URL ?? ''),
    }));
    const live = createLiveAiGateway(memorySettings(saved), { build });
    await live.gateway.listModels();
    await live.gateway.listModels();
    expect(build).toHaveBeenCalledTimes(1);
    saved['ai.ollamaBaseUrl'] = 'http://b:1';
    expect(await live.gateway.listModels()).toEqual([{ id: 'http://b:1', gateway: 'ollama' }]);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('decorates each resolution with its own provider name', async () => {
    const decorate = vi.fn((gateway: AiGateway, _provider: string) => gateway);
    const live = createLiveAiGateway(memorySettings({ 'ai.ollamaBaseUrl': 'http://a:1' }), {
      build: () => ({ kind: 'ollama', gateway: stub('x') }),
      decorate,
    });
    await live.gateway.listModels();
    expect(decorate).toHaveBeenCalledWith(expect.anything(), 'ollama');
  });

  it('fails a stream on its first chunk when nothing is configured', async () => {
    const live = createLiveAiGateway(memorySettings({}));
    const stream = live.gateway.streamCompletion({ model: 'm', messages: [] } as never);
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow('no model provider');
    expect(await live.provider()).toBeNull();
  });
});
