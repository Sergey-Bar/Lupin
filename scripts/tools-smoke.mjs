/**
 * `pnpm tools:smoke` — the two npm packages as a user installs them, on whatever runner this
 * is (`lib/pack-tools.mjs`), then run.
 *
 * - `lupin --help` answers and exits 0, through the installed `bin`, on this OS.
 * - With `PLAYWRIGHT_VERSION` set, that Playwright is installed beside the reporter and a
 *   one-test project runs with it. The reporter has no install to talk to, so it must say so on
 *   stderr and leave the run's own exit code alone — which is the whole contract a CI job
 *   relies on when its Lupin is down.
 *
 * Run by `.github/workflows/tools-matrix.yml` on ubuntu, windows and macos, and against the
 * oldest and newest Playwright the reporter's `peerDependencies` names. Needs network for the
 * Playwright install only.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TOOL_PACKAGES, installPackedTools } from './lib/pack-tools.mjs';

/** @type {string[]} */
const failures = [];
const check = (/** @type {boolean} */ ok, /** @type {string} */ what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const playwright = process.env['PLAYWRIGHT_VERSION']?.trim();
const tools = installPackedTools({ extra: playwright ? [`@playwright/test@${playwright}`] : [] });
try {
  check(
    tools.tarballs.length === TOOL_PACKAGES.length,
    `packed ${String(TOOL_PACKAGES.length)} tarballs (${tools.tarballs.join(', ')})`,
  );
  const help = spawnSync(process.execPath, [tools.cliEntry, '--help'], { encoding: 'utf8' });
  check(
    help.status === 0 && /Usage:/u.test(help.stdout),
    'lupin --help answers from the installed bin',
  );
  const refused = spawnSync(
    process.execPath,
    [tools.cliEntry, 'upload', '--format', 'sarif', '--file', 'x'],
    {
      encoding: 'utf8',
      env: { ...process.env, LUPIN_URL: '', LUPIN_TOKEN: '' },
    },
  );
  check(
    refused.status === 2,
    `lupin with no install configured exits 2, not a crash (got ${String(refused.status)})`,
  );

  if (playwright) {
    writeFileSync(
      path.join(tools.dir, 'playwright.config.mjs'),
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './e2e', reporter: [['list'], ['@lupin/playwright-reporter']] });\n",
    );
    mkdirSync(path.join(tools.dir, 'e2e'), { recursive: true });
    writeFileSync(
      path.join(tools.dir, 'e2e', 'one.spec.mjs'),
      "import { test, expect } from '@playwright/test';\ntest('adds', () => { expect(1 + 1).toBe(2); });\n",
    );
    const pw = path.join(tools.dir, 'node_modules', '@playwright', 'test', 'cli.js');
    const result = spawnSync(process.execPath, [pw, 'test', '--config', 'playwright.config.mjs'], {
      cwd: tools.dir,
      encoding: 'utf8',
      env: { ...process.env, LUPIN_URL: '', LUPIN_REPORTER_SECRET: '', CI: '1' },
    });
    check(
      result.status === 0,
      `Playwright ${playwright}: the run's exit code is its own (got ${String(result.status)})`,
    );
    check(
      /Lupin reporter:/u.test(result.stderr),
      `Playwright ${playwright}: the reporter says it has no install to send to`,
    );
  }
} finally {
  tools.cleanup();
}

if (failures.length > 0) {
  console.error(`tools smoke failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('tools smoke passed');
