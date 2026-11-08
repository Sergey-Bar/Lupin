import { describe, expect, it, vi } from 'vitest';
import { syntheticSlackToken } from '../test-support/synthetic-credentials.js';
import { aiEnvironment, createSettingTesters } from './settings-testers.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('setting testers', () => {
  it('reports a half-configured gateway as not ready, without a network call', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await createSettingTesters(fetchImpl).ai?.({
      'ai.gatewayUrl': 'https://kilo.test',
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('both be set') });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps settings onto the gateway environment, empty strings as absent', () => {
    expect(aiEnvironment({ 'ai.ollamaBaseUrl': ' http://o:1 ', 'ai.apiKey': '' })).toEqual({
      KILO_GATEWAY_URL: undefined,
      KILO_API_KEY: undefined,
      OLLAMA_BASE_URL: 'http://o:1',
    });
  });

  it('names the Slack workspace on success and the Slack error on refusal', async () => {
    const token = syntheticSlackToken();
    const ok = vi.fn<typeof fetch>(async () => json({ ok: true, team: 'Acme' }));
    expect(
      await createSettingTesters(ok)['integrations.slackBotToken']?.({
        'integrations.slackBotToken': token,
      }),
    ).toEqual({
      ok: true,
      message: 'Connected to the Acme workspace.',
    });
    expect(ok.mock.calls[0]?.[1]?.headers).toEqual({ authorization: `Bearer ${token}` });
    const refused = vi.fn<typeof fetch>(async () => json({ ok: false, error: 'invalid_auth' }));
    const result = await createSettingTesters(refused)['integrations.slackBotToken']?.({
      'integrations.slackBotToken': token,
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('invalid_auth') });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(await createSettingTesters(ok)['integrations.slackBotToken']?.({})).toMatchObject({
      ok: false,
    });
  });

  it('calls rate_limit on github.com by default and on an Enterprise address when set', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({}));
    const testers = createSettingTesters(fetchImpl);
    expect(await testers['integrations.githubApiUrl']?.({})).toMatchObject({ ok: true });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.github.com/rate_limit');
    await testers['integrations.githubApiUrl']?.({
      'integrations.githubApiUrl': 'https://ghe.test/api/v3/',
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://ghe.test/api/v3/rate_limit');
    const missing = createSettingTesters(vi.fn<typeof fetch>(async () => json({}, 404)));
    expect(await missing['integrations.githubApiUrl']?.({})).toMatchObject({
      ok: false,
      message: expect.stringContaining('/api/v3'),
    });
  });
});
