import { describe, expect, it, vi } from 'vitest';
import { canAdministerInstallation } from './roles.js';
import {
  createSettingsClient,
  explain,
  nameFromSource,
  SettingsApiError,
  slugFor,
} from './settings-client.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ONBOARDING = { steps: [], done: 1, total: 6, dismissed: false };
const READ = {
  key: 'ai.ollamaBaseUrl',
  source: 'ui',
  value: 'http://o:1',
  updatedAt: null,
  updatedBy: null,
};

describe('the settings client', () => {
  it('sends every call with the session and the right method, path and body', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const answers: Record<string, unknown> = {
      'GET /api/v1/settings': { settings: [READ] },
      'PUT /api/v1/settings/ai.ollamaBaseUrl': READ,
      'DELETE /api/v1/settings/ai.ollamaBaseUrl': READ,
      'POST /api/v1/settings/ai.ollamaBaseUrl/test': { ok: true, message: 'ok' },
      'GET /api/v1/onboarding': ONBOARDING,
      'POST /api/v1/onboarding/ai/dismiss': ONBOARDING,
      'POST /api/v1/onboarding/reset': ONBOARDING,
      'POST /api/v1/projects': { project: { id: 'p', name: 'n' }, commands: [] },
      'PATCH /api/v1/projects/p': { project: { id: 'p', name: 'n', defaultBranch: null } },
      'DELETE /api/v1/projects/p': { ok: true },
      'POST /api/v1/projects/p/detect': { profile: { commands: [{}, {}] }, evidence: [] },
      'GET /api/v1/projects/p/git-token': { set: true },
      'PUT /api/v1/projects/p/git-token': { set: true },
      'DELETE /api/v1/projects/p/git-token': { set: false },
      'GET /api/v1/dashboard/quality-gates': [],
      'POST /api/v1/dashboard/quality-gates': {
        id: 'g',
        name: 'n',
        passRateThreshold: 1,
        createdAt: 'x',
      },
      'PATCH /api/v1/dashboard/quality-gates/g': {
        id: 'g',
        name: 'n',
        passRateThreshold: 2,
        createdAt: 'x',
      },
      'DELETE /api/v1/dashboard/quality-gates/g': { ok: true },
      'POST /api/v1/settings/identity/draft': {
        id: 'd',
        needsTest: true,
        testUrl: '/t',
        expiresAt: 'x',
      },
      'GET /api/v1/settings/identity/draft/d': { id: 'd', verified: null },
      'POST /api/v1/settings/identity/apply': { settings: [] },
    };
    const fetchImpl = vi.fn<typeof fetch>(async (url, init = {}) => {
      calls.push([String(url), init]);
      return json(answers[`${init.method ?? 'GET'} ${String(url)}`]);
    });
    const client = createSettingsClient('', fetchImpl);
    expect(await client.listSettings()).toEqual([READ]);
    await client.putSetting('ai.ollamaBaseUrl', 'http://o:1');
    await client.revertSetting('ai.ollamaBaseUrl');
    await client.testSetting('ai.ollamaBaseUrl', '');
    await client.getOnboarding();
    await client.dismissStep('ai');
    await client.resetOnboarding();
    await client.registerProject({ name: 'n', slug: 'n', repoPath: '/r' });
    await client.updateProject('p', { name: 'n' });
    await client.deleteProject('p', 'n');
    expect(await client.detectProject('p')).toBe(2);
    expect(await client.gitTokenState('p')).toBe(true);
    await client.putGitToken('p', 't');
    await client.deleteGitToken('p');
    await client.listGates();
    await client.createGate({ name: 'n', passRateThreshold: 1 });
    await client.updateGate('g', { passRateThreshold: 2 });
    await client.deleteGate('g');
    await client.identityDraft({ 'identity.oidcRoleMap': 'admin:a@b.test' });
    await client.identityDraftStatus('d');
    await client.identityApply('d');
    expect(calls).toHaveLength(21);
    expect(calls.every(([, init]) => init.credentials === 'include')).toBe(true);
    expect(calls[1]?.[1].body).toBe(JSON.stringify({ value: 'http://o:1' }));
    expect(calls[9]?.[1].body).toBe(JSON.stringify({ confirm: 'n' }));
  });

  it('keeps the API’s code and fix, and explains a failure as reason then fix', async () => {
    const client = createSettingsClient(
      '',
      vi.fn<typeof fetch>(async () =>
        json(
          {
            error: {
              code: 'ENV_LOCKED',
              message: 'Set by the environment.',
              details: { fix: 'Change it there.' },
            },
          },
          409,
        ),
      ),
    );
    const error = await client
      .putSetting('ai.ollamaBaseUrl', 'x')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SettingsApiError);
    expect(error).toMatchObject({ status: 409, code: 'ENV_LOCKED', fix: 'Change it there.' });
    expect(explain(error, 'fallback')).toBe('Set by the environment. Change it there.');
  });

  it('describes a body that is not the API’s error shape, and a response of the wrong shape', async () => {
    const broken = createSettingsClient(
      '',
      vi.fn<typeof fetch>(async () => new Response('<html>', { status: 502 })),
    );
    await expect(broken.listSettings()).rejects.toMatchObject({
      detail: 'HTTP 502',
      code: null,
      fix: null,
    });
    const wrong = createSettingsClient(
      '',
      vi.fn<typeof fetch>(async () => json({ nope: true })),
    );
    const error = await wrong.listSettings().catch((caught: unknown) => caught);
    expect(explain(error, 'x')).toContain('did not match the expected shape');
    expect(explain({ detail: 'plain' }, 'x')).toBe('plain');
    expect(explain(null, 'fallback')).toBe('fallback');
    const noMessage = createSettingsClient(
      '',
      vi.fn<typeof fetch>(async () => json({ error: { code: 'X' } }, 400)),
    );
    await expect(noMessage.listSettings()).rejects.toMatchObject({ detail: 'HTTP 400', code: 'X' });
  });

  it('turns a name into a slug the API accepts, and a path or URL into a name', () => {
    expect(slugFor('My Shop!')).toBe('my-shop');
    expect(slugFor('---')).toBe('project-');
    expect(slugFor('Été')).toBe('ete');
    expect(nameFromSource('/home/me/code/shop/')).toBe('shop');
    expect(nameFromSource('git@github.com:acme/shop.git')).toBe('shop');
    expect(nameFromSource('C:\\src\\Shop')).toBe('Shop');
    expect(nameFromSource('')).toBe('');
  });

  it('mirrors the API’s installation-admin rule', () => {
    expect(canAdministerInstallation({ role: 'admin', source: 'installation' })).toBe(true);
    expect(canAdministerInstallation({ role: 'admin', source: 'anonymous' })).toBe(true);
    expect(canAdministerInstallation({ role: 'admin', source: 'cloudflare' })).toBe(true);
    expect(canAdministerInstallation({ role: 'admin', source: 'token' })).toBe(false);
    expect(canAdministerInstallation({ role: 'admin', source: 'user' })).toBe(false);
    expect(canAdministerInstallation({ role: 'admin' })).toBe(true);
    expect(canAdministerInstallation({ role: 'operator', source: 'installation' })).toBe(false);
  });
});
