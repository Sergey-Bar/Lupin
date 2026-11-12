import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A component stays reviewable (ledger MNT-191). `run-detail.tsx` reached 1,135 lines and was
 * split along its panels into `components/run-detail/`. The ten components still over the
 * limit are held where they are, as a ratchet: none may grow, a new file may not pass the
 * limit, and a file that drops below it leaves the list, so the ceiling only moves down. Split
 * one of them when it is next changed for a reason of its own.
 */
const LIMIT = 600;
const CEILINGS: Readonly<Record<string, number>> = {
  'components/Dashboard.tsx': 914,
  'components/SideNav.tsx': 903,
  'components/RepoHealth.tsx': 887,
  'components/SettingsPages.tsx': 807,
  'components/SupplyChain.tsx': 742,
  'components/Agents.tsx': 733,
  'components/Notifications.tsx': 713,
  'routes/dashboard/runner.tsx': 610,
};
const SRC = path.resolve(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/u.test(name) && !/\.test\.tsx$/u.test(name) ? [full] : [];
  });
}

function lineCount(file: string): number {
  return readFileSync(file, 'utf8').replace(/\n$/u, '').split('\n').length;
}

describe('the component-size ratchet', () => {
  const sizes = new Map(
    files(SRC).map((file) => [path.relative(SRC, file).replaceAll('\\', '/'), lineCount(file)]),
  );

  it(`keeps every component within ${String(LIMIT)} lines or its recorded ceiling`, () => {
    const over = [...sizes]
      .filter(([file, lines]) => lines > (CEILINGS[file] ?? LIMIT))
      .map(([file, lines]) => `${file}: ${String(lines)} > ${String(CEILINGS[file] ?? LIMIT)}`);
    expect(over).toEqual([]);
  });

  it('drops a ceiling once its file is within the limit, so the list only shrinks', () => {
    const stale = Object.keys(CEILINGS).filter((file) => (sizes.get(file) ?? 0) <= LIMIT);
    expect(stale).toEqual([]);
  });
});
