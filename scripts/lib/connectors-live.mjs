/**
 * The opt-in live check behind `live-verified` in `docs/quality/release-journeys.json`.
 *
 * For each connector, the one **read** its adapter offers (an identity or about call, never a
 * send), run only when that connector's secret is in the environment. A connector with no
 * secret is `not_configured` — never a pass — so the workflow can run on every fork and say
 * exactly which platforms a contributor has proved.
 *
 * Pure: the adapters and the environment are passed in, so the policy is tested without a
 * network (`connectors-live.test.mjs`).
 */

/**
 * @typedef {{ execute(request: { operation: string, input: unknown }, secret: string): Promise<{ status: string, error?: { code?: string } }> }} Adapter
 * @typedef {{ id: string, secretEnv: string, operation: string, input: (env: Record<string, string | undefined>) => unknown, needs?: string[] }} Probe
 * @typedef {{ id: string, result: 'passed' | 'failed' | 'not_configured', detail: string }} ProbeResult
 */

/** @type {readonly Probe[]} */
export const PROBES = Object.freeze([
  {
    id: 'github',
    secretEnv: 'LUPIN_LIVE_GITHUB_TOKEN',
    operation: 'getRepository',
    needs: ['LUPIN_LIVE_GITHUB_REPO'],
    input: (env) => repoOf(env['LUPIN_LIVE_GITHUB_REPO']),
  },
  {
    id: 'jira',
    secretEnv: 'LUPIN_LIVE_JIRA_TOKEN',
    operation: 'authTest',
    needs: ['LUPIN_LIVE_JIRA_BASE_URL'],
    input: (env) => ({ baseUrl: env['LUPIN_LIVE_JIRA_BASE_URL'] }),
  },
  { id: 'slack', secretEnv: 'LUPIN_LIVE_SLACK_TOKEN', operation: 'authTest', input: () => ({}) },
  { id: 'telegram', secretEnv: 'LUPIN_LIVE_TELEGRAM_TOKEN', operation: 'getMe', input: () => ({}) },
  {
    id: 'whatsapp',
    secretEnv: 'LUPIN_LIVE_WHATSAPP_TOKEN',
    operation: 'phoneNumber',
    needs: ['LUPIN_LIVE_WHATSAPP_PHONE_ID'],
    input: (env) => ({ phoneNumberId: env['LUPIN_LIVE_WHATSAPP_PHONE_ID'] }),
  },
  { id: 'signal', secretEnv: 'LUPIN_LIVE_SIGNAL_BRIDGE', operation: 'about', input: () => ({}) },
  // Teams' incoming webhook has no read: any request to it posts. It is never probed live.
]);

/** @param {string | undefined} value */
function repoOf(value) {
  const [owner = '', repo = ''] = (value ?? '').split('/');
  return { owner, repo };
}

/**
 * @param {Record<string, Adapter>} adapters
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<ProbeResult[]>}
 */
export async function runProbes(adapters, env) {
  /** @type {ProbeResult[]} */
  const results = [];
  for (const probe of PROBES) {
    const secret = env[probe.secretEnv]?.trim();
    const missing = [probe.secretEnv, ...(probe.needs ?? [])].filter((name) => !env[name]?.trim());
    if (secret === undefined || secret === '' || missing.length > 0) {
      results.push({ id: probe.id, result: 'not_configured', detail: `set ${missing.join(', ')}` });
      continue;
    }
    const adapter = adapters[probe.id];
    if (adapter === undefined) {
      results.push({ id: probe.id, result: 'failed', detail: 'no adapter' });
      continue;
    }
    const answer = await adapter.execute(
      { operation: probe.operation, input: probe.input(env) },
      secret,
    );
    results.push(
      answer.status === 'ok'
        ? { id: probe.id, result: 'passed', detail: probe.operation }
        : { id: probe.id, result: 'failed', detail: answer.error?.code ?? 'error' },
    );
  }
  results.push({
    id: 'teams',
    result: 'not_configured',
    detail: 'an incoming webhook has no read; never probed live',
  });
  return results;
}

/** Fails only on a probe that ran and failed: nothing configured is reported, not refused. */
/** @param {readonly ProbeResult[]} results */
export function exitCodeFor(results) {
  return results.some((entry) => entry.result === 'failed') ? 1 : 0;
}
