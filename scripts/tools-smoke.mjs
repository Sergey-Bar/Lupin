/**
 * `pnpm tools:smoke` — the two npm packages as a user installs them, on whatever runner this
 * is: built, `pnpm pack`ed, `npm install`ed from the tarballs into an empty folder, then run.
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
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PACKAGES = [
  ['@lupin/cli', 'tools/lupin-cli'],
  ['@lupin/playwright-reporter', 'tools/playwright-reporter'],
];

/** A package manager's JS entry, run with this Node so no shell is involved on Windows. */
function entryOf(/** @type {'pnpm' | 'npm'} */ tool) {
  if (tool === 'pnpm') {
    const execPath = process.env['npm_execpath'];
    if (execPath !== undefined && /pnpm/u.test(execPath) && existsSync(execPath)) return execPath;
    throw new Error('Run this through pnpm (pnpm tools:smoke).');
  }
  const bin = path.dirname(process.execPath);
  const found = [
    path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`npm is not installed beside ${process.execPath}`);
  return found;
}

/** @param {'pnpm' | 'npm'} tool @param {string[]} args @param {string} cwd */
const run = (tool, args, cwd) =>
  execFileSync(process.execPath, [entryOf(tool), ...args], { cwd, stdio: 'inherit' });

/** @type {string[]} */
const failures = [];
const check = (/** @type {boolean} */ ok, /** @type {string} */ what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const tarballs = mkdtempSync(path.join(tmpdir(), 'lupin-smoke-tgz-'));
const project = mkdtempSync(path.join(tmpdir(), 'lupin-smoke-project-'));
try {
  for (const [name, dir] of PACKAGES) {
    run('pnpm', ['--filter', `${name}...`, 'build'], ROOT);
    run('pnpm', ['pack', '--pack-destination', tarballs], path.join(ROOT, dir));
  }
  const files = readdirSync(tarballs).filter((file) => file.endsWith('.tgz'));
  check(
    files.length === PACKAGES.length,
    `packed ${String(PACKAGES.length)} tarballs (${files.join(', ')})`,
  );
  writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ name: 'smoke', private: true }),
  );
  const playwright = process.env['PLAYWRIGHT_VERSION']?.trim();
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      ...(playwright ? [`@playwright/test@${playwright}`] : ['--offline']),
      ...files.map((file) => path.join(tarballs, file)),
    ],
    project,
  );

  const cli = path.join(project, 'node_modules', '@lupin', 'cli', 'dist', 'index.js');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  check(
    help.status === 0 && /Usage:/u.test(help.stdout),
    'lupin --help answers from the installed bin',
  );
  const refused = spawnSync(process.execPath, [cli, 'upload', '--format', 'sarif', '--file', 'x'], {
    encoding: 'utf8',
    env: { ...process.env, LUPIN_URL: '', LUPIN_TOKEN: '' },
  });
  check(
    refused.status === 2,
    `lupin with no install configured exits 2, not a crash (got ${String(refused.status)})`,
  );

  if (playwright) {
    writeFileSync(
      path.join(project, 'playwright.config.mjs'),
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './e2e', reporter: [['list'], ['@lupin/playwright-reporter']] });\n",
    );
    mkdirSync(path.join(project, 'e2e'), { recursive: true });
    writeFileSync(
      path.join(project, 'e2e', 'one.spec.mjs'),
      "import { test, expect } from '@playwright/test';\ntest('adds', () => { expect(1 + 1).toBe(2); });\n",
    );
    const pw = path.join(project, 'node_modules', '@playwright', 'test', 'cli.js');
    const result = spawnSync(process.execPath, [pw, 'test', '--config', 'playwright.config.mjs'], {
      cwd: project,
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
  rmSync(tarballs, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`tools smoke failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('tools smoke passed');
