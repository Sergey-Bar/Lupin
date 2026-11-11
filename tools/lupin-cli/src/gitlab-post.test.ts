import { describe, expect, it } from 'vitest';
import { run } from './cli.js';
import { EXIT } from './errors.js';
import { gitlabTarget, mergeRequestOf, postToGitLab } from './gitlab-post.js';

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
    expect(() => gitlabTarget({ LUPIN_GITLAB_TOKEN: 't' })).toThrow(/CI_PROJECT_ID/u);
    expect(() => gitlabTarget({})).toThrow(/LUPIN_GITLAB_TOKEN/u);
    expect(() =>
      gitlabTarget({ LUPIN_GITLAB_TOKEN: 't', CI_PROJECT_ID: '1', CI_API_V4_URL: 'not a url' }),
    ).toThrow('CI_API_V4_URL is not a URL.');
    expect(() =>
      gitlabTarget({
        LUPIN_GITLAB_TOKEN: 't',
        CI_PROJECT_ID: '1',
        CI_API_V4_URL: 'https://u:p@gitlab.example/api/v4',
      }),
    ).toThrow(/no credentials/u);
  });

  it('reads the merge request only from a positive whole number', () => {
    expect(mergeRequestOf({ CI_MERGE_REQUEST_IID: '7' })).toBe(7);
    for (const iid of [undefined, '', '0', '-1', '2.5', 'x']) {
      expect(mergeRequestOf({ CI_MERGE_REQUEST_IID: iid }), String(iid)).toBeUndefined();
    }
  });
});

describe('postToGitLab', () => {
  type Answer = { status: number; text: string } | 'unreachable';
  const target = {
    api: new URL('https://gitlab.example/api/v4/'),
    project: '42',
    token: GITLAB_TOKEN,
  };
  const bare = {
    sha: SHA,
    status: { state: 'success' },
    checkRun: null,
    comment: { marker: '<!-- m -->', body: '<!-- m -->\nbody' },
  } as unknown as Parameters<typeof postToGitLab>[2];
  function forge(answer: (method: string, url: string) => Answer) {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      calls.push({
        method: String(init.method),
        url: url.href,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const reply = answer(String(init.method), url.href);
      if (reply === 'unreachable') throw new TypeError('fetch failed');
      return new Response(reply.text === '' ? null : reply.text, { status: reply.status });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it('sends a passing status with the default name, and no fields the server did not give', async () => {
    const { calls, fetchImpl } = forge(() => ({ status: 201, text: '' }));
    expect(await postToGitLab(fetchImpl, target, bare, undefined)).toEqual([
      'Posted the commit status (created).',
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://gitlab.example/api/v4/projects/42/statuses/${SHA}`);
    expect(calls[0]?.body).toEqual({ state: 'success', name: 'lupin/health' });
  });

  it('cuts a description to the 255 characters GitLab accepts', async () => {
    const { calls, fetchImpl } = forge(() => ({ status: 201, text: '{}' }));
    const long = { ...bare, status: { state: 'failure', description: 'x'.repeat(300) } };
    await postToGitLab(fetchImpl, target, long, undefined);
    expect((calls[0]?.body as { description: string }).description).toHaveLength(255);
  });

  it('says GitLab was unreachable rather than naming an HTTP status it never sent', async () => {
    const { fetchImpl } = forge(() => 'unreachable');
    expect(await postToGitLab(fetchImpl, target, bare, 7)).toEqual([
      "GitLab refused the commit status (unreachable); the gate's verdict stands.",
      "GitLab refused the merge request note (unreachable); the gate's verdict stands.",
    ]);
  });

  it('writes no note when it cannot read the existing ones', async () => {
    const { calls, fetchImpl } = forge((method) =>
      method === 'GET' ? { status: 404, text: 'not json' } : { status: 201, text: '{}' },
    );
    expect(await postToGitLab(fetchImpl, target, bare, 7)).toContain(
      "GitLab refused the merge request note (HTTP 404); the gate's verdict stands.",
    );
    expect(calls.map((call) => call.method)).toEqual(['POST', 'GET']);
  });

  it('reports a refused note write, and treats a list that is not an array as no notes', async () => {
    const { calls, fetchImpl } = forge((method, url) =>
      method === 'GET'
        ? { status: 200, text: '{"id":1}' }
        : url.endsWith('/notes')
          ? { status: 422, text: '{}' }
          : { status: 201, text: '{}' },
    );
    expect(await postToGitLab(fetchImpl, target, bare, 7)).toContain(
      "GitLab refused the merge request note (HTTP 422); the gate's verdict stands.",
    );
    expect(calls.at(-1)?.method).toBe('POST');
  });

  it('skips a note without an id, and posts no note when the server rendered none', async () => {
    const { calls, fetchImpl } = forge((method) =>
      method === 'GET'
        ? { status: 200, text: JSON.stringify([{ body: '<!-- m -->\nold' }, 'junk']) }
        : { status: 201, text: '{}' },
    );
    expect(await postToGitLab(fetchImpl, target, bare, 7)).toContain(
      'Posted the merge request note (created).',
    );
    expect(calls.at(-1)?.method).toBe('POST');
    const quiet = forge(() => ({ status: 201, text: '{}' }));
    await postToGitLab(quiet.fetchImpl, target, { ...bare, comment: null }, 7);
    expect(quiet.calls).toHaveLength(1);
  });
});
