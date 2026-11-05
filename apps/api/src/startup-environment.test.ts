import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dotEnvCandidates, isTestContext, planStartupEnvironment } from './startup-environment.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('isTestContext', () => {
  it('is a test under Vitest and under NODE_ENV=test', () => {
    expect(isTestContext({ VITEST: 'true' })).toBe(true);
    expect(isTestContext({ NODE_ENV: 'test' })).toBe(true);
  });

  it('is not a test for a VITEST value Vitest never writes', () => {
    expect(isTestContext({ VITEST: '' })).toBe(false);
    expect(isTestContext({ VITEST: 'false' })).toBe(false);
    expect(isTestContext({ NODE_ENV: 'production' })).toBe(false);
    expect(isTestContext({})).toBe(false);
  });
});

describe('planStartupEnvironment', () => {
  it('loads .env and starts the reporter on a serving process', () => {
    expect(planStartupEnvironment({ NODE_ENV: 'production' })).toEqual({
      loadDotEnv: true,
      initErrorReporter: true,
    });
    expect(planStartupEnvironment({ NODE_ENV: 'development', VITEST: 'false' })).toEqual({
      loadDotEnv: true,
      initErrorReporter: true,
    });
  });

  it('does neither under a test, which owns its environment', () => {
    for (const env of [{ VITEST: 'true' }, { NODE_ENV: 'test' }]) {
      expect(planStartupEnvironment(env)).toEqual({ loadDotEnv: false, initErrorReporter: false });
    }
  });

  it('skips only .env when the caller supplies the whole environment', () => {
    expect(planStartupEnvironment({ NODE_ENV: 'development', LUPIN_SKIP_DOTENV: '1' })).toEqual({
      loadDotEnv: false,
      initErrorReporter: true,
    });
    expect(planStartupEnvironment({ LUPIN_SKIP_DOTENV: '0' }).loadDotEnv).toBe(true);
  });
});

describe('dotEnvCandidates', () => {
  it('names the repository root first, then apps/api, from src and from dist alike', () => {
    const root = path.resolve(here, '../../..');
    const pkg = path.resolve(here, '..');
    for (const directory of [here, path.join(pkg, 'dist')]) {
      expect(dotEnvCandidates(directory)).toEqual([
        path.join(root, '.env'),
        path.join(pkg, '.env'),
      ]);
    }
  });
});

describe('the composition root', () => {
  it('imports instrument before any other module, so .env is read before config is', () => {
    const source = readFileSync(path.join(here, 'index.ts'), 'utf8');
    const firstImport = /^import\s[^;]*?;/msu.exec(source)?.[0];
    expect(firstImport).toBe("import './instrument.js';");
  });
});
