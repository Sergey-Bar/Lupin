import { isTestPath } from './diff-guard.js';

/**
 * `lupin impact`'s reading of a change: which tests to run first, and why. Pure.
 *
 * Three rules, each named in the answer so a reader can check it:
 *
 * - **changed:** a test file the change touched runs;
 * - **named:** a test named after a changed source file runs (`cart.ts` → `cart.test.ts`,
 *   `cart.spec.tsx`, `__tests__/cart.ts`, `test_cart.py`, `cart_test.go`), nearest first;
 * - **everything:** a change to what every test depends on (a manifest, a lockfile, a test or
 *   build config) means the selection cannot be trusted, so the answer is to run them all.
 *
 * A changed source file with no test named after it is listed, not hidden: it is a change no
 * test is known to cover. Nothing here guesses beyond names, so a test that covers a file it is
 * not named after is not found, and the answer says the selection is by name.
 */

export const IMPACT_VERSION = 'impact/1';

export type ImpactReason = 'changed' | 'named';

export interface ImpactedTest {
  path: string;
  reason: ImpactReason;
  /** The changed source file it is named after; `null` for a changed test. */
  source: string | null;
}

export interface ImpactReport {
  version: string;
  /** Run everything: why. `null` when the selection stands. */
  runAll: string | null;
  tests: ImpactedTest[];
  /** Changed source files with no test named after them. */
  untested: string[];
  changedFiles: number;
}

const normal = (path: string) => path.replace(/\\/gu, '/').replace(/^\.\//u, '');

/** Files every test depends on: a change to one means the selection cannot be trusted. */
const EVERYTHING = [
  /(^|\/)package\.json$/u,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/u,
  /(^|\/)(go\.mod|go\.sum|requirements[\w.-]*\.txt|pyproject\.toml|poetry\.lock|Pipfile\.lock)$/u,
  /(^|\/)tsconfig[\w.-]*\.json$/u,
  /(^|\/)(vitest|jest|playwright|cypress|vite|babel|webpack)\.config\.[cm]?[jt]s$/u,
  /(^|\/)(pytest\.ini|conftest\.py|setup\.cfg|tox\.ini)$/u,
];

const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|java|kt|rb|cs|php|swift|vue|svelte)$/u;

function parts(path: string): { directory: string; stem: string } {
  const at = path.lastIndexOf('/');
  const base = at === -1 ? path : path.slice(at + 1);
  const dot = base.indexOf('.');
  return {
    directory: at === -1 ? '' : path.slice(0, at),
    stem: dot <= 0 ? base : base.slice(0, dot),
  };
}

/** The stem a test file is named after: `cart.test.ts` → `cart`, `test_cart.py` → `cart`. */
export function testStem(path: string): string {
  const { stem } = parts(normal(path));
  return stem.replace(/^test_/u, '').replace(/_test$/u, '');
}

/** Shared leading directories: how near a test is to the source it is named after. */
function nearness(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) {
    shared += 1;
  }
  return shared;
}

function namedTests(source: string, tests: readonly string[], byStem: Map<string, string[]>) {
  const { directory, stem } = parts(source);
  const candidates = byStem.get(stem) ?? [];
  if (candidates.length === 0) return [];
  const best = Math.max(...candidates.map((test) => nearness(directory, parts(test).directory)));
  // The nearest ones only: `src/cart.ts` picks `src/cart.test.ts` over `legacy/cart.test.ts`.
  return candidates.filter((test) => nearness(directory, parts(test).directory) === best);
}

function testsByStem(tests: readonly string[]): Map<string, string[]> {
  const byStem = new Map<string, string[]>();
  for (const test of tests) {
    const stem = testStem(test);
    byStem.set(stem, [...(byStem.get(stem) ?? []), test]);
  }
  return byStem;
}

/** Each changed test, and the tests named after each changed source; and the sources with none. */
function pick(changed: readonly string[], tests: readonly string[]) {
  const byStem = testsByStem(tests);
  const picked = new Map<string, ImpactedTest>();
  const untested: string[] = [];
  for (const path of changed) {
    if (isTestPath(path)) {
      picked.set(path, { path, reason: 'changed', source: null });
      continue;
    }
    if (!SOURCE.test(path)) continue;
    const named = namedTests(path, tests, byStem);
    if (named.length === 0) untested.push(path);
    for (const test of named) {
      if (!picked.has(test)) picked.set(test, { path: test, reason: 'named', source: path });
    }
  }
  return { picked, untested };
}

export function selectTests(
  changedPaths: readonly string[],
  trackedFiles: readonly string[],
): ImpactReport {
  const changed = [...new Set(changedPaths.map(normal).filter((path) => path !== ''))].sort();
  const tests = [...new Set(trackedFiles.map(normal).filter(isTestPath))].sort();
  const everything = changed.find((path) => EVERYTHING.some((pattern) => pattern.test(path)));
  const { picked, untested } = pick(changed, tests);
  return {
    version: IMPACT_VERSION,
    runAll: everything === undefined ? null : `${everything} changed, and every test depends on it`,
    tests: [...picked.values()].sort((a, b) => a.path.localeCompare(b.path)),
    untested,
    changedFiles: changed.length,
  };
}
