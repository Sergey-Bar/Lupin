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
