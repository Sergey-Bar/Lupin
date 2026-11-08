import type { SettingTestResult } from '@lupin/shared-contracts';
import { resolveAiGateway } from '../observability/ai-gateway.js';
import type { SettingTesters } from '../routes/settings.js';
import type { SettingValue } from './settings-service.js';

/**
 * The "Test" button behind each settings group: one real call to the thing being configured,
 * and one sentence back. Never saves; never echoes a credential.
 */
const TIMEOUT_MS = 8_000;

function text(value: SettingValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The AI gateway's environment, from settings, so the test uses exactly what chat would. */
export function aiEnvironment(values: Record<string, SettingValue | undefined>) {
  return {
    KILO_GATEWAY_URL: text(values['ai.gatewayUrl']),
    KILO_API_KEY: text(values['ai.apiKey']),
    OLLAMA_BASE_URL: text(values['ai.ollamaBaseUrl']),
  };
}

export function createSettingTesters(fetchImpl: typeof fetch = fetch): SettingTesters {
  const get = (url: string, init: RequestInit = {}) =>
    fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

  return {
    async ai(values): Promise<SettingTestResult> {
      const resolution = resolveAiGateway(aiEnvironment(values));
      if (resolution.kind === 'none') {
        return { ok: false, message: `Not ready yet: ${resolution.reason}.` };
      }
      const models = await resolution.gateway.listModels();
      return {
        ok: true,
        message: `Connected: ${models.length} model${models.length === 1 ? '' : 's'} available.`,
      };
    },

    async 'integrations.slackBotToken'(values): Promise<SettingTestResult> {
      const token = text(values['integrations.slackBotToken']);
      if (token === undefined) return { ok: false, message: 'Paste a bot token first.' };
      const response = await get('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        team?: string;
        error?: string;
      };
      return body.ok === true
        ? { ok: true, message: `Connected to the ${body.team ?? 'Slack'} workspace.` }
        : {
            ok: false,
            message: `Slack refused the token (${body.error ?? response.status}). Copy the Bot User OAuth Token again.`,
          };
    },

    async 'integrations.githubApiUrl'(values): Promise<SettingTestResult> {
      const base = text(values['integrations.githubApiUrl']) ?? 'https://api.github.com';
      const response = await get(`${base.replace(/\/$/u, '')}/rate_limit`, {
        headers: { accept: 'application/vnd.github+json' },
      });
      return response.ok
        ? { ok: true, message: 'GitHub answered at this address.' }
        : {
            ok: false,
            message: `GitHub answered ${response.status}. For Enterprise Server the address ends in /api/v3.`,
          };
    },
  };
}
