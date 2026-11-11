import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeDiff } from './diff-guard.js';
import { gitWith, runGit } from './diff-guard-command.js';

/**
 * The guard against a real repository: a base commit with a test, and a head that skips it.
 * This is the only suite that spawns git, so the parser is proved against git's own output
 * and not only against the fixtures the other suite writes by hand.
 */
let repository: string;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repository, stdio: ['ignore', 'pipe', 'ignore'] });

beforeAll(async () => {
  repository = await mkdtemp(path.join(os.tmpdir(), 'lupin-diff-guard-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'ci@example.com');
  git('config', 'user.name', 'CI');
  git('config', 'commit.gpgsign', 'false');
  await writeFile(
    path.join(repository, 'cart.test.ts'),
    "it('adds', () => {\n  expect(add(1, 1)).toBe(2);\n});\n",
  );
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  git('checkout', '--quiet', '-b', 'change');
  await writeFile(
    path.join(repository, 'cart.test.ts'),
    "it.skip('adds', () => {\n  expect(add(1, 1)).toBe(2);\n});\n",
  );
  git('commit', '--quiet', '-am', 'skip it');
});

afterAll(async () => {
  await rm(repository, { recursive: true, force: true });
});

const DIFF = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--unified=0',
  '--find-renames',
  'main...HEAD',
];

describe('runGit', () => {
  it('reads the diff git writes, and the guard finds the skip in it', async () => {
    const result = await runGit(DIFF, repository);
    expect(result).toMatchObject({ code: 0, truncated: false });
    expect(analyzeDiff(result.stdout).findings).toEqual([
      { kind: 'skip-added', path: 'cart.test.ts', line: 1, side: 'head' },
    ]);
  });

  it('reports git’s own failure for a base that does not exist', async () => {
    const result = await runGit(['diff', 'no-such-branch...HEAD'], repository);
    expect(result.code).not.toBe(0);
  });

  it('cuts the diff at its limit and says so, rather than failing', async () => {
    const result = await gitWith({ limit: 16 })(DIFF, repository);
    expect(result).toMatchObject({ code: 0, truncated: true });
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(16);
  });

  it('answers 127 when git is not installed', async () => {
    const result = await gitWith({ limit: 16, command: 'lupin-no-such-git' })(DIFF, repository);
    expect(result).toEqual({ code: 127, stdout: '', truncated: false });
  });
});
