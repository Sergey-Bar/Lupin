import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The two npm packages exactly as a user installs them: built, `pnpm pack`ed (so `workspace:`
 * and `catalog:` are rewritten as they are on publish), then `npm install`ed from the tarballs
 * into an empty folder. A spec that imported the tools from `src/` would prove the source
 * works and say nothing about the `files` list, the `bin` entry or the shebang, which is what
 * a published package gets wrong.
 */
export interface PackedTools {
  /** The folder the tarballs were installed into; a user's project. */
  dir: string;
  /** `node <this>` is `npx lupin` from that project. */
  cliEntry: string;
  /** Resolves `@playwright/test`'s CLI, for running a Playwright project in `dir`. */
  playwrightCli: string;
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PACKAGES = ['@lupin/cli', '@lupin/playwright-reporter'] as const;

/**
 * The JavaScript entry of a package manager, run with this Node so no shell is involved:
 * `pnpm` from `npm_execpath` (the suite runs under pnpm), `npm` from beside the Node binary,
 * where every Node install puts it (`node_modules/npm` on Windows, `lib/node_modules/npm`
 * elsewhere).
 */
function entryOf(tool: 'pnpm' | 'npm'): string {
  if (tool === 'pnpm') {
    const execPath = process.env['npm_execpath'];
    if (execPath !== undefined && /pnpm/u.test(execPath) && existsSync(execPath)) return execPath;
    throw new Error('Run the suite through pnpm (pnpm test:e2e); npm_execpath does not name pnpm.');
  }
  const bin = path.dirname(process.execPath);
  const found = [
    path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`npm is not installed beside ${process.execPath}`);
  return found;
}

function run(tool: 'pnpm' | 'npm', args: string[], cwd: string): void {
  execFileSync(process.execPath, [entryOf(tool), ...args], { cwd, stdio: 'pipe' });
}

export function packTools(): PackedTools {
  const tarballs = mkdtempSync(path.join(tmpdir(), 'lupin-tarballs-'));
  for (const name of PACKAGES) {
    run('pnpm', ['--filter', name, 'build'], REPO_ROOT);
    const dir = name === '@lupin/cli' ? 'tools/lupin-cli' : 'tools/playwright-reporter';
    run('pnpm', ['pack', '--pack-destination', tarballs], path.join(REPO_ROOT, dir));
  }
  const files = readdirSync(tarballs).filter((file) => file.endsWith('.tgz'));
  if (files.length !== PACKAGES.length) {
    throw new Error(`expected ${String(PACKAGES.length)} tarballs, found ${files.join(', ')}`);
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'lupin-ci-project-'));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'ci-project', private: true }),
  );
  // Neither package has a runtime dependency, so this needs no registry.
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--offline',
      ...files.map((file) => path.join(tarballs, file)),
    ],
    dir,
  );

  // The reporter runs inside the user's own Playwright. Link this checkout's rather than
  // downloading one, so the spec needs no network; a junction because Windows allows it unelevated.
  const require = createRequire(path.join(REPO_ROOT, 'package.json'));
  const playwrightRoot = path.dirname(require.resolve('@playwright/test/package.json'));
  mkdirSync(path.join(dir, 'node_modules', '@playwright'), { recursive: true });
  symlinkSync(playwrightRoot, path.join(dir, 'node_modules', '@playwright', 'test'), 'junction');

  return {
    dir,
    cliEntry: path.join(dir, 'node_modules', '@lupin', 'cli', 'dist', 'index.js'),
    playwrightCli: path.join(playwrightRoot, 'cli.js'),
  };
}
