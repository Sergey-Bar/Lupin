import { describe, expect, it } from 'vitest';
import { run } from './cli.js';
import { EXIT } from './errors.js';
import { githubTarget, payloadOf } from './github-post.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
// Both assembled at runtime: a credential-shaped literal is what the secret scanners look for.
const LUPIN_TOKEN = ['lup_', 'ci', '_uploader'].join('');
const GITHUB_TOKEN = ['ghs_', 'job', '_installation'].join('');
const SHA = 'abcdef1234567';

const payload = {
  sha: SHA,
  status: { state: 'failure', context: 'lupin/health', description: 'Risk high · Graded B' },
  checkRun: {
    name: 'lupin/change-risk',
    status: 'completed',
    conclusion: 'neutral',
    output: { title: 'Change risk: high · 55 points', summary: 'S', annotations: [] },
  },
  comment: {
    marker: '<!-- lupin-health -->',
    body: '<!-- lupin-health -->\n### Repository health',
  },
};

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A Lupin and a GitHub on two origins, each answering from its own table. */
function harness(options: {
  answer?: Record<string, unknown>;
  github?: (call: Call) => { status: number; body: unknown };
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
        JSON.stringify(
          options.answer ?? {
            verdict: 'failed',
            reasons: ['Risk.'],
            grade: { letter: 'B' },
            github: null,
            githubPayload: payload,
          },
        ),
        { status: 200 },
      );
    }
    const answer = options.github?.(call) ?? { status: 200, body: [] };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof fetch;
  const io = {
    env: {
      LUPIN_URL: 'https://lupin.example',
      LUPIN_TOKEN,
      LUPIN_PROJECT: PROJECT,
      GITHUB_TOKEN,
      GITHUB_REPOSITORY: 'acme/shop',
      ...options.env,
    },
    cwd: '.',
    fetch: fetchImpl,
    now: () => new Date('2026-11-11T00:00:00Z'),
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
  };
  const lupin = () => calls.filter((call) => call.url.startsWith('https://lupin.example'));
  const github = () => calls.filter((call) => call.url.startsWith('https://api.github.com'));
  return { io, out, err, lupin, github };
}

const GATE = ['gate', '--branch', 'feature', '--commit', SHA, '--pr', '12', '--post'];

describe('lupin gate --post', () => {
  it('posts the status, the check run and the comment, and keeps the gate’s exit code', async () => {
    const { io, out, github } = harness({});
    expect(await run(GATE, io)).toBe(EXIT.gateFailed);
    expect(github().map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      `POST /repos/acme/shop/statuses/${SHA}`,
      `GET /repos/acme/shop/commits/${SHA}/check-runs`,
      'POST /repos/acme/shop/check-runs',
      'GET /repos/acme/shop/issues/12/comments',
      'POST /repos/acme/shop/issues/12/comments',
    ]);
    expect(JSON.parse(github()[0]?.body ?? '{}')).toEqual(payload.status);
    expect(JSON.parse(github()[2]?.body ?? '{}')).toEqual({ ...payload.checkRun, head_sha: SHA });
    expect(JSON.parse(github()[4]?.body ?? '{}')).toEqual({ body: payload.comment.body });
    expect(out).toEqual(
      expect.arrayContaining([
        'Posted the commit status (created).',
        'Posted the check run (created).',
        'Posted the pull request comment (created).',
      ]),
    );
  });

  it('never sends the GitHub token to Lupin, nor the Lupin token to GitHub', async () => {
    const { io, lupin, github } = harness({});
    await run(GATE, io);
    for (const call of lupin()) {
      expect(JSON.stringify(call)).not.toContain(GITHUB_TOKEN);
      expect(call.headers['authorization']).toBe(`Bearer ${LUPIN_TOKEN}`);
    }
    for (const call of github()) {
      expect(JSON.stringify(call)).not.toContain(LUPIN_TOKEN);
      expect(call.headers['authorization']).toBe(`Bearer ${GITHUB_TOKEN}`);
    }
    expect(github().length).toBeGreaterThan(0);
  });

  it('updates the comment and the check run that are already there, so a rerun adds nothing', async () => {
    const { io, out, github } = harness({
      github: (call) => {
        if (call.url.includes('/check-runs?')) {
          return { status: 200, body: { check_runs: [{ id: 41, name: 'lupin/change-risk' }] } };
        }
        if (call.method === 'GET' && call.url.includes('/comments')) {
          return {
            status: 200,
            body: [
              { id: 5, body: 'unrelated' },
              { id: 9, body: '<!-- lupin-health -->\nold' },
            ],
          };
        }
        return { status: 200, body: {} };
      },
    });
    await run(GATE, io);
    expect(github().map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      `POST /repos/acme/shop/statuses/${SHA}`,
      `GET /repos/acme/shop/commits/${SHA}/check-runs`,
      'PATCH /repos/acme/shop/check-runs/41',
      'GET /repos/acme/shop/issues/12/comments',
      'PATCH /repos/acme/shop/issues/comments/9',
    ]);
    expect(out).toContain('Posted the pull request comment (updated).');
  });

  it('says what GitHub refused and still exits with the gate’s verdict', async () => {
    const { io, out } = harness({
      answer: {
        verdict: 'passed',
        reasons: [],
        grade: { letter: 'A' },
        github: null,
        githubPayload: payload,
      },
      github: () => ({ status: 403, body: { message: 'Resource not accessible by integration' } }),
    });
    expect(await run(GATE, io)).toBe(EXIT.ok);
    expect(out).toContain(
      "GitHub refused the commit status (HTTP 403); the gate's verdict stands.",
    );
    expect(out).toContain("GitHub refused the check run (HTTP 403); the gate's verdict stands.");
  });

  it('posts nothing when the server already did, or sent nothing to post', async () => {
    const posted = harness({
      answer: { verdict: 'passed', reasons: [], grade: { letter: 'A' }, github: { status: true } },
    });
    await run(GATE, posted.io);
    expect(posted.github()).toHaveLength(0);
    expect(posted.out).toContain('The server posted to GitHub itself; nothing to post from here.');
    const old = harness({ answer: { verdict: 'passed', reasons: [], grade: { letter: 'A' } } });
    await run(GATE, old.io);
    expect(old.github()).toHaveLength(0);
    expect(old.out).toContain('The server sent nothing to post; this install may predate --post.');
  });

  it('skips the comment without a pull request number', async () => {
    const { io, github } = harness({});
    await run(['gate', '--branch', 'feature', '--commit', SHA, '--post'], io);
    expect(github().some((call) => call.url.includes('/comments'))).toBe(false);
  });

  it('refuses --post without a token or a repository, before asking the gate', async () => {
    const noToken = harness({ env: { GITHUB_TOKEN: undefined } });
    expect(await run(GATE, noToken.io)).toBe(EXIT.usage);
    expect(noToken.err[0]).toMatch(/GITHUB_TOKEN/u);
    expect(noToken.lupin()).toHaveLength(0);
    const noRepo = harness({ env: { GITHUB_REPOSITORY: 'not a repo' } });
    expect(await run(GATE, noRepo.io)).toBe(EXIT.usage);
  });

  it('says an unreachable GitHub is unreachable', async () => {
    const { io, out } = harness({});
    const throwing = (async (url: URL, init: RequestInit) => {
      if (url.origin !== 'https://lupin.example') throw new Error('ECONNRESET');
      return io.fetch(url, init);
    }) as unknown as typeof fetch;
    await run(GATE, { ...io, fetch: throwing });
    expect(out).toContain(
      "GitHub refused the commit status (unreachable); the gate's verdict stands.",
    );
  });
});

describe('githubTarget', () => {
  const env = { GITHUB_TOKEN, GITHUB_REPOSITORY: 'acme/shop' };

  it('defaults to api.github.com and reads a GitHub Enterprise Server API', () => {
    expect(githubTarget(env).api.href).toBe('https://api.github.com/');
    expect(githubTarget({ ...env, GITHUB_API_URL: 'https://ghe.example/api/v3' }).api.href).toBe(
      'https://ghe.example/api/v3',
    );
  });

  it('refuses plain http, credentials in the URL, and a URL that is not one', () => {
    expect(() => githubTarget({ ...env, GITHUB_API_URL: 'http://ghe.example/api' })).toThrow(
      /https/u,
    );
    expect(() => githubTarget({ ...env, GITHUB_API_URL: 'https://u:p@ghe.example' })).toThrow(
      /credentials/u,
    );
    expect(() => githubTarget({ ...env, GITHUB_API_URL: 'not a url' })).toThrow(/not a URL/u);
  });
});

describe('payloadOf', () => {
  it('reads a payload and refuses one with no sha or a malformed one', () => {
    expect(payloadOf({ githubPayload: payload })?.sha).toBe(SHA);
    expect(payloadOf({ githubPayload: { ...payload, sha: 'zzz' } })).toBeNull();
    expect(payloadOf({ githubPayload: { ...payload, status: 'x' } })).toBeNull();
    expect(payloadOf(null)).toBeNull();
    expect(
      payloadOf({ githubPayload: { ...payload, checkRun: { no: 'name' }, comment: 7 } }),
    ).toMatchObject({ checkRun: null, comment: null });
  });
});
