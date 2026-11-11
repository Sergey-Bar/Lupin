import { describe, expect, it } from 'vitest';
import { run } from './cli.js';
import type { Git } from './diff-guard-command.js';
import { EXIT } from './errors.js';

const TRACKED = ['src/cart.ts', 'src/cart.test.ts', 'src/orders.ts', 'package.json'].join('\n');

function harness(
  changed: string,
  options: { failGit?: boolean; env?: Record<string, string> } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const gitCalls: (readonly string[])[] = [];
  const fetched: string[] = [];
  const git: Git = (args) => {
    gitCalls.push(args);
    if (options.failGit === true)
      return Promise.resolve({ code: 128, stdout: '', truncated: false });
    return Promise.resolve({
      code: 0,
      stdout: args[0] === 'ls-files' ? TRACKED : changed,
      truncated: false,
    });
  };
  const io = {
    env: { GITHUB_BASE_REF: 'main', ...options.env },
    cwd: '.',
    fetch: (async (url: URL) => {
      fetched.push(url.href);
      return new Response('{}');
    }) as unknown as typeof fetch,
    now: () => new Date('2026-11-11T00:00:00Z'),
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
    git,
  };
  return { io, out, err, gitCalls, fetched };
}

describe('lupin impact', () => {
  it('lists the tests to run with why, and the changes no test is named after, sending nothing', async () => {
    const { io, out, gitCalls, fetched } = harness('src/cart.ts\nsrc/orders.ts\n');
    expect(await run(['impact'], io)).toBe(EXIT.ok);
    expect(gitCalls[0]).toEqual(['diff', '--name-only', '--no-renames', 'origin/main...HEAD']);
    expect(out).toEqual([
      'impact: 1 test file(s) for 2 changed file(s), selected by name:',
      '  - src/cart.test.ts (named after src/cart.ts)',
      'impact: 1 changed source file(s) no test is named after:',
      '  - src/orders.ts',
    ]);
    expect(fetched).toEqual([]);
  });

  it('prints bare paths for a test runner, and every test when the selection cannot be trusted', async () => {
    const one = harness('src/cart.ts\n');
    await run(['impact', '--format', 'paths'], one.io);
    expect(one.out).toEqual(['src/cart.test.ts']);
    const all = harness('package.json\n');
    await run(['impact', '--format', 'paths'], all.io);
    expect(all.out).toEqual(['src/cart.test.ts']);
    const text = harness('package.json\n');
    await run(['impact'], text.io);
    expect(text.out).toEqual([
      'impact: run every test: package.json changed, and every test depends on it.',
    ]);
  });

  it('answers JSON for a script', async () => {
    const { io, out } = harness('src/cart.test.ts\n');
    await run(['impact', '--format', 'json', '--base', 'origin/develop'], io);
    expect(JSON.parse(out[0] ?? '{}')).toMatchObject({
      version: 'impact/1',
      tests: [{ path: 'src/cart.test.ts', reason: 'changed' }],
    });
  });

  it('refuses a ref git would read as an option, a format it does not know, and a missing base', async () => {
    expect(await run(['impact', '--base', '--output=x'], harness('').io)).toBe(EXIT.usage);
    expect(await run(['impact', '--format', 'xml'], harness('').io)).toBe(EXIT.usage);
    expect(await run(['impact'], harness('', { env: { GITHUB_BASE_REF: '' } }).io)).toBe(
      EXIT.usage,
    );
    const broken = harness('', { failGit: true });
    expect(await run(['impact'], broken.io)).toBe(EXIT.usage);
    expect(broken.err[0]).toMatch(/fetch-depth: 0/u);
  });
});
