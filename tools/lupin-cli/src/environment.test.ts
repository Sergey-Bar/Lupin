import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEnvironment } from './environment.js';

/**
 * The shipped binary only ever sees what `readEnvironment` passes on (`index.ts`), while every
 * command's tests inject `env` directly. So a variable a command reads and this list omits works in
 * every test and in no CI job — which is how GitLab support and Cloudflare Access were both broken
 * in the published CLI. These tests close that gap from the source, in both directions.
 */
const SRC = import.meta.dirname;

function namesTheCommandsRead(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(SRC)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'environment.ts') continue;
    const text = readFileSync(path.join(SRC, file), 'utf8');
    for (const match of text.matchAll(/env\[\s*'([A-Z][A-Z0-9_]+)'\s*\]/gu))
      names.add(match[1] ?? '');
    // `GITLAB_ENV`-style tables: `key: 'NAME'` inside an object literal used as env keys.
    for (const match of text.matchAll(/^\s+\w+:\s*'((?:CI|GITLAB|LUPIN)_[A-Z0-9_]+)',?$/gmu)) {
      names.add(match[1] ?? '');
    }
  }
  return [...names].sort();
}

afterEach(() => vi.unstubAllEnvs());

describe('what the binary passes on from the environment', () => {
  it('includes every variable a command reads', () => {
    const passed = Object.keys(readEnvironment());
    const missing = namesTheCommandsRead().filter((name) => !passed.includes(name));
    expect(missing, 'read by a command but never passed on by readEnvironment').toEqual([]);
  });

  it('carries GitLab CI’s branch, commit and merge request, and the Cloudflare Access pair', () => {
    for (const [name, value] of Object.entries({
      GITLAB_CI: 'true',
      CI_COMMIT_REF_NAME: 'feat/x',
      CI_COMMIT_SHA: 'abc1234',
      CI_MERGE_REQUEST_IID: '7',
      LUPIN_CF_ACCESS_CLIENT_ID: 'id',
      LUPIN_CF_ACCESS_CLIENT_SECRET: 'secret',
    })) {
      vi.stubEnv(name, value);
    }
    expect(readEnvironment()).toMatchObject({
      GITLAB_CI: 'true',
      CI_COMMIT_REF_NAME: 'feat/x',
      CI_COMMIT_SHA: 'abc1234',
      CI_MERGE_REQUEST_IID: '7',
      LUPIN_CF_ACCESS_CLIENT_ID: 'id',
      LUPIN_CF_ACCESS_CLIENT_SECRET: 'secret',
    });
  });
});
