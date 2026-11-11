import { describe, expect, it } from 'vitest';
import { run } from './cli.js';
import type { Git, GitResult } from './diff-guard-command.js';
import { EXIT } from './errors.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
// Assembled at runtime: a credential-shaped literal is what the secret scanners look for.
const TOKEN = ['lup_', 'ci', '_uploader_token'].join('');
const SHA = 'abcdef1234567';

const SKIPPED = [
  'diff --git a/src/cart.test.ts b/src/cart.test.ts',
  'index 1111111..2222222 100644',
  '--- a/src/cart.test.ts',
  '+++ b/src/cart.test.ts',
  '@@ -10,0 +11 @@',
  "+  it.skip('adds SECRET_PRODUCT_NAME', () => {",
].join('\n');

interface Call {
  url: string;
  init: RequestInit;
}

function harness(options: {
  env?: Record<string, string | undefined>;
  git?: GitResult;
  status?: number;
}) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Call[] = [];
  const gitCalls: (readonly string[])[] = [];
  const git: Git = (args) => {
    gitCalls.push(args);
    return Promise.resolve(options.git ?? { code: 0, stdout: SKIPPED, truncated: false });
  };
  const fetchImpl = (async (url: URL, init: RequestInit) => {
    calls.push({ url: url.href, init });
    return new Response('{}', { status: options.status ?? 200 });
  }) as unknown as typeof fetch;
  const io = {
    env: {
      LUPIN_URL: 'https://lupin.example',
      LUPIN_TOKEN: TOKEN,
      LUPIN_PROJECT: PROJECT,
      LUPIN_COMMIT: SHA,
      GITHUB_BASE_REF: 'main',
      ...options.env,
    },
    cwd: '.',
    fetch: fetchImpl,
    now: () => new Date('2026-11-11T00:00:00Z'),
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
    git,
  };
  return { io, out, err, calls, gitCalls };
}

describe('lupin diff-guard', () => {
  it('diffs against origin/<base> on GitHub Actions, prints what it found, and sends it', async () => {
    const { io, out, calls, gitCalls } = harness({});
    expect(await run(['diff-guard', '--pr', '12'], io)).toBe(EXIT.ok);
    expect(gitCalls[0]).toEqual([
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--unified=0',
      '--find-renames',
      'origin/main...HEAD',
    ]);
    expect(out).toContain('diff-guard: 1 change weaken the tests (1 file checked):');
    expect(out).toContain('  - skip or focus added: src/cart.test.ts:11');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://lupin.example/api/v1/projects/${PROJECT}/health/diff-guard`,
    );
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ commit: SHA, base: 'origin/main', pullRequest: 12 });
  });

  it('sends no line of source, and the token only in its header', async () => {
    const { io, calls } = harness({});
    await run(['diff-guard'], io);
    const body = String(calls[0]?.init.body);
    expect(body).not.toContain('SECRET_PRODUCT_NAME');
    expect(body).not.toContain('it.skip');
    expect(body).not.toContain(TOKEN);
    expect(calls[0]?.init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  });

  it('sends nothing on --dry-run, and needs no install to do it', async () => {
    const { io, out, calls } = harness({
      env: { LUPIN_URL: undefined, LUPIN_TOKEN: undefined, LUPIN_COMMIT: undefined },
    });
    expect(await run(['diff-guard', '--dry-run', '--base', 'origin/develop'], io)).toBe(EXIT.ok);
    expect(calls).toHaveLength(0);
    expect(out[0]).toBe('diff-guard: 1 change weaken the tests (1 file checked):');
  });

  it('fails the step only when asked to', async () => {
    const { io } = harness({});
    expect(await run(['diff-guard', '--fail-on-findings'], io)).toBe(EXIT.gateFailed);
    const clean = harness({ git: { code: 0, stdout: '', truncated: false } });
    expect(await run(['diff-guard', '--fail-on-findings'], clean.io)).toBe(EXIT.ok);
    expect(clean.out[0]).toBe('diff-guard: no change weakens the tests (0 files checked).');
  });

  it('asks for a base when CI names none, and refuses one git would read as an option', async () => {
    const none = harness({ env: { GITHUB_BASE_REF: undefined } });
    expect(await run(['diff-guard'], none.io)).toBe(EXIT.usage);
    expect(none.err[0]).toMatch(/--base origin\/main/u);
    expect(none.gitCalls).toHaveLength(0);
    for (const bad of ['--output=/tmp/x', 'main..evil', 'a b']) {
      const attempt = harness({});
      expect(await run(['diff-guard', `--base=${bad}`], attempt.io)).toBe(EXIT.usage);
      expect(attempt.gitCalls).toHaveLength(0);
    }
  });

  it('prefers LUPIN_BASE over the CI base', async () => {
    const { io, gitCalls } = harness({ env: { LUPIN_BASE: 'origin/release' } });
    await run(['diff-guard', '--dry-run'], io);
    expect(gitCalls[0]?.at(-1)).toBe('origin/release...HEAD');
  });

  it('says how to fetch the base when git cannot diff against it, and sends nothing', async () => {
    const { io, err, calls } = harness({ git: { code: 128, stdout: '', truncated: false } });
    expect(await run(['diff-guard'], io)).toBe(EXIT.usage);
    expect(err[0]).toMatch(/fetch-depth: 0/u);
    expect(calls).toHaveLength(0);
  });

  it('needs a commit to send, and checks the token before reading the diff', async () => {
    const noCommit = harness({ env: { LUPIN_COMMIT: undefined } });
    expect(await run(['diff-guard'], noCommit.io)).toBe(EXIT.usage);
    const noToken = harness({ env: { LUPIN_TOKEN: undefined } });
    expect(await run(['diff-guard'], noToken.io)).toBe(EXIT.usage);
    expect(noToken.gitCalls).toHaveLength(0);
  });

  it('refuses a pull request that is not a number', async () => {
    const { io } = harness({});
    expect(await run(['diff-guard', '--pr', 'twelve'], io)).toBe(EXIT.usage);
  });

  it('says when the diff was cut short', async () => {
    const { io, out } = harness({ git: { code: 0, stdout: SKIPPED, truncated: true } });
    await run(['diff-guard', '--dry-run'], io);
    expect(out.at(-1)).toMatch(/cut short; counts are a lower bound/u);
  });

  it('lists ten findings and counts the rest', async () => {
    const lines = Array.from({ length: 12 }, (_, index) => `+xit('t${String(index)}', () => {`);
    const stdout = [
      'diff --git a/src/many.test.ts b/src/many.test.ts',
      '--- a/src/many.test.ts',
      '+++ b/src/many.test.ts',
      '@@ -0,0 +1,12 @@',
      ...lines,
    ].join('\n');
    const { io, out } = harness({ git: { code: 0, stdout, truncated: false } });
    await run(['diff-guard', '--dry-run'], io);
    expect(out.filter((line) => line.startsWith('  - '))).toHaveLength(10);
    expect(out.at(-1)).toBe('  …and 2 more');
  });

  it('marks a finding on the line before the change', async () => {
    const stdout = [
      'diff --git a/src/cart.test.ts b/src/cart.test.ts',
      '--- a/src/cart.test.ts',
      '+++ b/src/cart.test.ts',
      '@@ -5 +4,0 @@',
      '-  expect(total).toBe(10);',
    ].join('\n');
    const { io, out } = harness({ git: { code: 0, stdout, truncated: false } });
    await run(['diff-guard', '--dry-run'], io);
    expect(out).toContain('  - assertion removed: src/cart.test.ts:5 (before the change)');
  });

  it('keeps the server’s refusal as its exit code', async () => {
    const { io } = harness({ status: 403 });
    expect(await run(['diff-guard'], io)).toBe(EXIT.unauthorised);
  });
});
