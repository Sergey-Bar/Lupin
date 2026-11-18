/**
 * The two npm packages as a user installs them: built, `pnpm pack`ed (so `workspace:` and
 * `catalog:` are rewritten as on publish), and `npm install`ed from the tarballs into an empty
 * folder. Shared by `tools:smoke` and `dogfood`, so the one way a published package is made is
 * written once.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const TOOL_PACKAGES = Object.freeze([
  ['@lupin/cli', 'tools/lupin-cli'],
  ['@lupin/playwright-reporter', 'tools/playwright-reporter'],
]);

/**
 * A package manager's JS entry, run with this Node so no shell is involved on Windows.
 * @param {'pnpm' | 'npm'} tool
 * @returns {string}
 */
export function entryOf(tool) {
  if (tool === 'pnpm') {
    const execPath = process.env['npm_execpath'];
    if (execPath !== undefined && /pnpm/u.test(execPath) && existsSync(execPath)) return execPath;
    throw new Error('Run this through pnpm; npm_execpath does not name pnpm.');
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
export function runTool(tool, args, cwd) {
  execFileSync(process.execPath, [entryOf(tool), ...args], { cwd, stdio: 'inherit' });
}

/**
 * Packs both tools and installs them, with `extra` packages, into a new folder.
 * @param {{ extra?: string[] }} [options]
 * @returns {{ dir: string, tarballs: string[], cliEntry: string, cleanup: () => void }}
 */
export function installPackedTools(options = {}) {
  const tarballDir = mkdtempSync(path.join(tmpdir(), 'lupin-tgz-'));
  const dir = mkdtempSync(path.join(tmpdir(), 'lupin-project-'));
  for (const [name, packageDir] of TOOL_PACKAGES) {
    runTool('pnpm', ['--filter', `${name}...`, 'build'], REPO_ROOT);
    runTool('pnpm', ['pack', '--pack-destination', tarballDir], path.join(REPO_ROOT, packageDir));
  }
  const tarballs = readdirSync(tarballDir).filter((file) => file.endsWith('.tgz'));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'ci-project', private: true }),
  );
  const extra = options.extra ?? [];
  runTool(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      ...(extra.length === 0 ? ['--offline'] : extra),
      ...tarballs.map((file) => path.join(tarballDir, file)),
    ],
    dir,
  );
  return {
    dir,
    tarballs,
    cliEntry: path.join(dir, 'node_modules', '@lupin', 'cli', 'dist', 'index.js'),
    cleanup: () => {
      rmSync(tarballDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
