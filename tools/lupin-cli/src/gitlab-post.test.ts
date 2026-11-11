import { describe, expect, it } from 'vitest';
import { run } from './cli.js';
import { EXIT } from './errors.js';
import { gitlabTarget } from './gitlab-post.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
// Both assembled at runtime: a credential-shaped literal is what the secret scanners look for.
const LUPIN_TOKEN = ['lup_', 'ci', '_uploader'].join('');
const GITLAB_TOKEN = ['glpat-', 'job', '_project'].join('');
const SHA = 'abcdef1234567';

const payload = {
  sha: SHA,
  status: {
    state: 'failure',
    context: 'lupin/health',
    description: 'Risk high · Graded B',
    target_url: 'https://lupin.example/dashboard/repo/x',
  },
  checkRun: { name: 'lupin/change-risk', status: 'completed', conclusion: 'neutral' },
  comment: { marker: '<!-- lupin-health -->', body: '<!-- lupin-health -->\n### Health' },
};

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function harness(options: {
  gitlab?: (call: Call) => { status: number; body: unknown };
  env?: Record<string, string | undefined>;
}) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Call[] = [];
  const fetchImpl = (async (url: URL, init: RequestInit) => {
    const call: Call = {
      method: String(init.method),
      url: url.href,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    if (url.origin === 'https://lupin.example') {
      return new Response(
        JSON.stringify({
          verdict: 'failed',
          reasons: ['Risk.'],
          grade: { letter: 'B' },
          github: null,
          githubPayload: payload,
        }),
        { status: 200 },
      );
    }
    const answer = options.gitlab?.(call) ?? { status: 200, body: [] };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof fetch;
  const io = {
    env: {
      LUPIN_URL: 'https://lupin.example',
      LUPIN_TOKEN,
      LUPIN_PROJECT: PROJECT,
      GITLAB_CI: 'true',
      CI_PROJECT_ID: '42',
      CI_API_V4_URL: 'https://gitlab.example/api/v4',
      CI_COMMIT_SHA: SHA,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature',
      CI_MERGE_REQUEST_IID: '7',
      LUPIN_GITLAB_TOKEN: GITLAB_TOKEN,
      ...options.env,
    },
    cwd: '.',
    fetch: fetchImpl,
    now: () => new Date('2026-11-11T00:00:00Z'),
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
  };
  return { io, out, err, calls };
}

describe('lupin gate --post on GitLab CI', () => {
  it('reads the branch, commit and merge request from GitLab, and posts a status and a note', async () => {
    const { io, out, calls } = harness({});
    expect(await run(['gate', '--post'], io)).toBe(EXIT.gateFailed);
    const gate = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(gate).toEqual({ branch: 'feature', commit: SHA, pullRequest: 7 });
    const forge = calls.slice(1);
    expect(forge.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST https://gitlab.example/api/v4/projects/42/statuses/${SHA}`,
      'GET https://gitlab.example/api/v4/projects/42/merge_requests/7/notes?per_page=100&sort=asc',
      'POST https://gitlab.example/api/v4/projects/42/merge_requests/7/notes',
    ]);
    expect(JSON.parse(forge[0]?.body ?? '{}')).toEqual({
      state: 'failed',
      name: 'lupin/health',
      description: 'Risk high · Graded B',
      target_url: 'https://lupin.example/dashboard/repo/x',
    });
    expect(out).toContain('Posted the commit status (created).');
    expect(out).toContain('Posted the merge request note (created).');
  });

  it('keeps the two tokens apart: the GitLab one never reaches Lupin, nor the other way', async () => {
    const { io, calls } = harness({});
    await run(['gate', '--post'], io);
    const lupin = calls.filter((call) => call.url.startsWith('https://lupin.example'));
    const gitlab = calls.filter((call) => call.url.startsWith('https://gitlab.example'));
    for (const call of lupin) expect(JSON.stringify(call.headers)).not.toContain(GITLAB_TOKEN);
    for (const call of gitlab) {
      expect(call.headers['private-token']).toBe(GITLAB_TOKEN);
      expect(JSON.stringify(call.headers)).not.toContain(LUPIN_TOKEN);
    }
  });

  it('updates the note it wrote before rather than adding a second one', async () => {
    const { io, calls } = harness({
      gitlab: (call) =>
        call.method === 'GET'
          ? {
              status: 200,
              body: [
                { id: 3, body: 'other' },
                { id: 9, body: '<!-- lupin-health -->\nold' },
              ],
            }
          : { status: 200, body: {} },
    });
    await run(['gate', '--post'], io);
    expect(calls.at(-1)).toMatchObject({
      method: 'PUT',
      url: 'https://gitlab.example/api/v4/projects/42/merge_requests/7/notes/9',
    });
  });

  it('prints a refusal from GitLab and keeps the gate’s exit code', async () => {
    const { io, out } = harness({ gitlab: () => ({ status: 403, body: {} }) });
    expect(await run(['gate', '--post'], io)).toBe(EXIT.gateFailed);
    expect(out).toContain(
      "GitLab refused the commit status (HTTP 403); the gate's verdict stands.",
    );
  });

  it('refuses before asking the gate when the token, project or API address is unusable', async () => {
    for (const env of [
      { LUPIN_GITLAB_TOKEN: '' },
      { CI_PROJECT_ID: 'group/repo' },
      { CI_API_V4_URL: 'http://gitlab.example/api/v4' },
    ]) {
      const { io, calls } = harness({ env });
      expect(await run(['gate', '--post'], io), JSON.stringify(env)).toBe(EXIT.usage);
      expect(calls).toHaveLength(0);
    }
    expect(gitlabTarget({ LUPIN_GITLAB_TOKEN: 't', CI_PROJECT_ID: '1' }).api.href).toBe(
      'https://gitlab.com/api/v4',
    );
  });
});
