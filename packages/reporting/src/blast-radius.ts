import { codeownersMatches, type CodeownersRule } from './flow.js';

/**
 * What a change can break beyond its own lines: the sensitive areas it touches, the teams that
 * own what it touches, and the tests that have failed together with those files before.
 *
 * Pure. No person is named: CODEOWNERS entries that are people are counted and dropped, and
 * only team handles (`@org/team`) leave this function. A change whose file list was cut short
 * says so, because "touches nothing sensitive" over the first 300 files is not a statement
 * about the rest.
 */

/** The area catalogue. Bump it whenever an area or a pattern changes. */
export const BLAST_RADIUS_VERSION = 'blast-radius/1';

export const SENSITIVE_AREAS = [
  'auth',
  'secrets',
  'migrations',
  'ci',
  'infra',
  'dependencies',
  'agent-config',
  'test-config',
] as const;
export type SensitiveArea = (typeof SENSITIVE_AREAS)[number];

/** Paths kept per area, so a reader sees which files without the whole list. */
export const AREA_PATH_LIMIT = 5;
/** Linked tests kept, most failures first. */
export const LINKED_TEST_LIMIT = 20;

interface PathParts {
  path: string;
  /** Every directory segment, lower-cased. */
  directories: readonly string[];
  /** The file name, lower-cased. */
  base: string;
  /** Every word in every segment, split on `.`, `-` and `_`, lower-cased. */
  words: ReadonlySet<string>;
}

const normalise = (path: string) => path.replace(/\\/gu, '/').replace(/^(?:\.\/|\/)+/u, '');

function partsOf(raw: string): PathParts {
  const path = normalise(raw);
  const segments = path.toLowerCase().split('/');
  // `split` always returns at least one element, so the last one is the file name.
  const base = segments[segments.length - 1] as string;
  const words = new Set(segments.flatMap((segment) => segment.split(/[.\-_]/u)));
  return { path, directories: segments.slice(0, -1), base, words };
}

const AUTH_WORDS = [
  'auth',
  'authn',
  'authz',
  'oauth',
  'oidc',
  'saml',
  'sso',
  'session',
  'sessions',
  'login',
  'logout',
  'permission',
  'permissions',
  'rbac',
  'acl',
  'identity',
];
const SECRET_WORDS = ['vault', 'secret', 'secrets', 'credential', 'credentials', 'crypto', 'kms'];
const CI_BASES = [
  '.gitlab-ci.yml',
  'jenkinsfile',
  'azure-pipelines.yml',
  'bitbucket-pipelines.yml',
  '.travis.yml',
];
const CI_PREFIXES = [
  '.github/workflows/',
  '.github/actions/',
  '.circleci/',
  '.husky/',
  '.buildkite/',
];
const INFRA_DIRECTORIES = ['infra', 'terraform', 'k8s', 'kubernetes', 'helm', 'charts', 'deploy'];
const DEPENDENCY_BASES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'go.mod',
  'go.sum',
  'cargo.toml',
  'cargo.lock',
  'pom.xml',
  'gemfile',
  'gemfile.lock',
  'pyproject.toml',
  'poetry.lock',
  'pipfile',
  'pipfile.lock',
  'composer.json',
  'composer.lock',
];
const AGENT_BASES = [
  'agents.md',
  'claude.md',
  'gemini.md',
  'skill.md',
  'copilot-instructions.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
];
const AGENT_ROOTS = ['.kilo', '.kiro', '.cursor', '.claude', '.windsurf', '.clinerules'];
const TEST_CONFIG_BASES = [
  'codecov.yml',
  '.codecov.yml',
  '.c8rc.json',
  'pytest.ini',
  '.coveragerc',
];

const hasWord = (parts: PathParts, words: readonly string[]) =>
  words.some((word) => parts.words.has(word));

const AREA_TEST: Readonly<Record<SensitiveArea, (parts: PathParts) => boolean>> = {
  auth: (parts) => hasWord(parts, AUTH_WORDS),
  secrets: (parts) => hasWord(parts, SECRET_WORDS),
  migrations: (parts) =>
    parts.base.endsWith('.sql') ||
    parts.directories.some((directory) =>
      ['migrations', 'migration', 'migrate'].includes(directory),
    ),
  ci: (parts) => {
    const lower = parts.path.toLowerCase();
    return CI_BASES.includes(parts.base) || CI_PREFIXES.some((prefix) => lower.startsWith(prefix));
  },
  infra: (parts) =>
    parts.base.startsWith('dockerfile') ||
    parts.base.startsWith('docker-compose') ||
    /^compose\.ya?ml$/u.test(parts.base) ||
    /\.(?:tf|tfvars)$/u.test(parts.base) ||
    parts.directories.some((directory) => INFRA_DIRECTORIES.includes(directory)),
  dependencies: (parts) =>
    DEPENDENCY_BASES.includes(parts.base) ||
    /^requirements[\w.-]*\.txt$/u.test(parts.base) ||
    /^build\.gradle(?:\.kts)?$/u.test(parts.base),
  'agent-config': (parts) =>
    AGENT_BASES.includes(parts.base) ||
    AGENT_ROOTS.includes(parts.directories[0] ?? '') ||
    parts.path.toLowerCase().startsWith('.github/agents/'),
  'test-config': (parts) =>
    TEST_CONFIG_BASES.includes(parts.base) ||
    parts.base.startsWith('.nycrc') ||
    /^(?:vitest|jest|playwright|cypress|karma|stryker)\.config\./u.test(parts.base),
};

/** The sensitive areas one path belongs to, in catalogue order. */
export function sensitiveAreasOf(path: string): SensitiveArea[] {
  const parts = partsOf(path);
  return SENSITIVE_AREAS.filter((area) => AREA_TEST[area](parts));
}

/** A row of `test_failure_correlations`: a test that failed while this file was changed. */
export interface FailureCorrelation {
  testStableId: string;
  sourceFilePath: string;
  failureCount: number;
}

export interface BlastRadiusInput {
  /** The changed paths the sync kept (GitHub's first 300). */
  changedPaths: readonly string[];
  /** How many files GitHub says the change touches. More than the paths means truncated. */
  changedFiles: number;
  /** The project's CODEOWNERS rules, or `null` when it has none. */
  codeowners: readonly CodeownersRule[] | null;
  correlations: readonly FailureCorrelation[];
}

export interface AreaTouch {
  area: SensitiveArea;
  count: number;
  /** At most {@link AREA_PATH_LIMIT}. */
  paths: string[];
}

export interface LinkedTest {
  testStableId: string;
  /** Failures recorded with any of the changed files. */
  failures: number;
  /** How many of the changed files it failed with. */
  files: number;
}

export interface BlastRadius {
  version: string;
  sensitiveAreas: AreaTouch[];
  /** Team handles that own a changed path, sorted. People are never listed. */
  teams: string[];
  /** Distinct people CODEOWNERS names for the changed paths; `null` with no CODEOWNERS. */
  individualOwners: number | null;
  /** Changed paths no rule owns; `null` with no CODEOWNERS, which is unknown, not unowned. */
  unownedPaths: number | null;
  /** At most {@link LINKED_TEST_LIMIT}, most failures first. */
  linkedTests: LinkedTest[];
  linkedTestsTotal: number;
  /** The file list was cut short, so every count here is a lower bound. */
  truncated: boolean;
  /** The two facts the change-risk model reads. */
  forRisk: { sensitiveAreas: SensitiveArea[]; truncated: boolean };
}

const TEAM = /^@[^/\s]+\/[^/\s]+$/u;

/** The owners of the last rule that matches, as GitHub reads CODEOWNERS. */
function ownersOf(path: string, rules: readonly CodeownersRule[]): readonly string[] {
  let owners: readonly string[] = [];
  for (const rule of rules) {
    if (codeownersMatches(rule.pattern, path)) owners = rule.owners;
  }
  return owners;
}

function ownership(paths: readonly string[], rules: readonly CodeownersRule[] | null) {
  if (rules === null) return { teams: [], individualOwners: null, unownedPaths: null };
  const teams = new Set<string>();
  const people = new Set<string>();
  let unowned = 0;
  for (const path of paths) {
    const owners = ownersOf(path, rules);
    if (owners.length === 0) unowned += 1;
    for (const owner of owners) (TEAM.test(owner) ? teams : people).add(owner.toLowerCase());
  }
  return { teams: [...teams].sort(), individualOwners: people.size, unownedPaths: unowned };
}

function linked(paths: ReadonlySet<string>, correlations: readonly FailureCorrelation[]) {
  const tests = new Map<string, { failures: number; files: Set<string> }>();
  for (const row of correlations) {
    const file = normalise(row.sourceFilePath);
    if (row.failureCount <= 0 || !paths.has(file)) continue;
    const entry = tests.get(row.testStableId) ?? { failures: 0, files: new Set<string>() };
    entry.failures += row.failureCount;
    entry.files.add(file);
    tests.set(row.testStableId, entry);
  }
  const all = [...tests]
    .map(([testStableId, entry]) => ({
      testStableId,
      failures: entry.failures,
      files: entry.files.size,
    }))
    .sort(
      (a, b) =>
        b.failures - a.failures ||
        (a.testStableId < b.testStableId ? -1 : a.testStableId > b.testStableId ? 1 : 0),
    );
  return { linkedTests: all.slice(0, LINKED_TEST_LIMIT), linkedTestsTotal: all.length };
}

export function blastRadius(input: BlastRadiusInput): BlastRadius {
  const paths = [...new Set(input.changedPaths.map(normalise))];
  const touches = new Map<SensitiveArea, string[]>();
  for (const path of paths) {
    for (const area of sensitiveAreasOf(path))
      touches.set(area, [...(touches.get(area) ?? []), path]);
  }
  const sensitiveAreas = SENSITIVE_AREAS.flatMap((area) => {
    const hit = touches.get(area);
    return hit === undefined
      ? []
      : [{ area, count: hit.length, paths: hit.slice(0, AREA_PATH_LIMIT) }];
  });
  const truncated = input.changedFiles > input.changedPaths.length;
  return {
    version: BLAST_RADIUS_VERSION,
    sensitiveAreas,
    ...ownership(paths, input.codeowners),
    ...linked(new Set(paths), input.correlations),
    truncated,
    forRisk: { sensitiveAreas: sensitiveAreas.map((touch) => touch.area), truncated },
  };
}
