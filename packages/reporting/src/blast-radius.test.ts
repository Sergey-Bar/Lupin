import { describe, expect, it } from 'vitest';
import {
  BLAST_RADIUS_VERSION,
  LINKED_TEST_LIMIT,
  blastRadius,
  sensitiveAreasOf,
  type BlastRadiusInput,
} from './blast-radius.js';

const input = (overrides: Partial<BlastRadiusInput> = {}): BlastRadiusInput => ({
  changedPaths: [],
  changedFiles: 0,
  codeowners: null,
  correlations: [],
  ...overrides,
});

describe('sensitiveAreasOf', () => {
  it.each([
    ['apps/api/src/auth/session.ts', 'auth'],
    ['packages/auth/src/permissions.ts', 'auth'],
    ['apps/api/src/routes/oidc.ts', 'auth'],
    ['apps/api/src/services/vault-secrets.ts', 'secrets'],
    ['packages/db/migrations/0040_x.sql', 'migrations'],
    ['db/schema.sql', 'migrations'],
    ['.github/workflows/unified-ci.yml', 'ci'],
    ['.gitlab-ci.yml', 'ci'],
    ['Jenkinsfile', 'ci'],
    ['.husky/pre-commit', 'ci'],
    ['infra/compose/docker-compose.unified.yml', 'infra'],
    ['apps/api/Dockerfile', 'infra'],
    ['deploy/main.tf', 'infra'],
    ['package.json', 'dependencies'],
    ['apps/web/package.json', 'dependencies'],
    ['pnpm-lock.yaml', 'dependencies'],
    ['go.sum', 'dependencies'],
    ['requirements-dev.txt', 'dependencies'],
    ['AGENTS.md', 'agent-config'],
    ['.kilo/agent/code-reviewer.md', 'agent-config'],
    ['.cursor/rules/x.mdc', 'agent-config'],
    ['.github/copilot-instructions.md', 'agent-config'],
    ['.kilo/skills/x/SKILL.md', 'agent-config'],
    ['vitest.config.ts', 'test-config'],
    ['apps/web/playwright.config.ts', 'test-config'],
    ['.config/stryker.config.mjs', 'test-config'],
  ])('reads %s as %s', (path, area) => {
    expect(sensitiveAreasOf(path)).toContain(area);
  });

  it.each([
    'apps/web/src/components/Author.tsx',
    'docs/authoring-guide.md',
    'src/lib/package-name.ts',
    'apps/api/src/routes/projects.ts',
    'README.md',
  ])('reads %s as not sensitive', (path) => {
    expect(sensitiveAreasOf(path)).toEqual([]);
  });

  it('reads Windows separators and a leading ./ as the same path', () => {
    expect(sensitiveAreasOf('.\\packages\\db\\migrations\\0001.sql')).toEqual(['migrations']);
  });
});

describe('blastRadius', () => {
  it('names each sensitive area once, in catalogue order, with a few of its paths', () => {
    const radius = blastRadius(
      input({
        changedPaths: [
          'packages/db/migrations/0040_a.sql',
          'apps/api/src/auth/login.ts',
          'packages/db/migrations/0041_b.sql',
          'apps/web/src/App.tsx',
        ],
        changedFiles: 4,
      }),
    );
    expect(radius.version).toBe(BLAST_RADIUS_VERSION);
    expect(radius.sensitiveAreas).toEqual([
      { area: 'auth', count: 1, paths: ['apps/api/src/auth/login.ts'] },
      {
        area: 'migrations',
        count: 2,
        paths: ['packages/db/migrations/0040_a.sql', 'packages/db/migrations/0041_b.sql'],
      },
    ]);
    expect(radius.truncated).toBe(false);
  });

  it('says it was truncated when GitHub reported more files than were stored', () => {
    const radius = blastRadius(input({ changedPaths: ['a.ts'], changedFiles: 301 }));
    expect(radius.truncated).toBe(true);
  });

  it('names owning teams and only counts the people, last matching rule winning', () => {
    const radius = blastRadius(
      input({
        changedPaths: ['apps/api/src/x.ts', 'apps/web/src/y.tsx', 'scripts/z.mjs'],
        changedFiles: 3,
        codeowners: [
          { pattern: '*', owners: ['@acme/platform'] },
          { pattern: '/apps/api/', owners: ['@acme/backend', '@alice', 'bob@example.com'] },
          { pattern: '/apps/web/', owners: ['@acme/frontend', '@alice'] },
          { pattern: '/scripts/', owners: [] },
        ],
      }),
    );
    expect(radius.teams).toEqual(['@acme/backend', '@acme/frontend']);
    expect(radius.individualOwners).toBe(2);
    expect(radius.unownedPaths).toBe(1);
    // No person's handle appears anywhere in the result.
    expect(JSON.stringify(radius)).not.toMatch(/alice|bob/u);
  });

  it('reports ownership as unknown without a CODEOWNERS file, not as unowned', () => {
    const radius = blastRadius(input({ changedPaths: ['a.ts'], changedFiles: 1 }));
    expect(radius.teams).toEqual([]);
    expect(radius.unownedPaths).toBeNull();
    expect(radius.individualOwners).toBeNull();
  });

  it('links the tests that have failed with the changed files, most failures first', () => {
    const radius = blastRadius(
      input({
        changedPaths: ['src/cart.ts', 'src/price.ts'],
        changedFiles: 2,
        correlations: [
          { testStableId: 't-checkout', sourceFilePath: 'src/cart.ts', failureCount: 3 },
          { testStableId: 't-checkout', sourceFilePath: 'src/price.ts', failureCount: 2 },
          { testStableId: 't-price', sourceFilePath: 'src/price.ts', failureCount: 4 },
          { testStableId: 't-other', sourceFilePath: 'src/unrelated.ts', failureCount: 9 },
          { testStableId: 't-never', sourceFilePath: 'src/cart.ts', failureCount: 0 },
        ],
      }),
    );
    expect(radius.linkedTests).toEqual([
      { testStableId: 't-checkout', failures: 5, files: 2 },
      { testStableId: 't-price', failures: 4, files: 1 },
    ]);
    expect(radius.linkedTestsTotal).toBe(2);
  });

  it('keeps at most the linked-test limit and says how many there were', () => {
    const correlations = Array.from({ length: LINKED_TEST_LIMIT + 5 }, (_, index) => ({
      // Written in reverse, so the order out is the sort's and not the input's.
      testStableId: `t-${String(LINKED_TEST_LIMIT + 4 - index).padStart(3, '0')}`,
      sourceFilePath: 'src/a.ts',
      failureCount: 1,
    }));
    const radius = blastRadius(
      input({ changedPaths: ['src/a.ts'], changedFiles: 1, correlations }),
    );
    expect(radius.linkedTests).toHaveLength(LINKED_TEST_LIMIT);
    expect(radius.linkedTestsTotal).toBe(LINKED_TEST_LIMIT + 5);
    expect(radius.linkedTests[0]?.testStableId).toBe('t-000');
  });

  it('gives the change-risk model the area names and the truncation', () => {
    const radius = blastRadius(
      input({ changedPaths: ['.github/workflows/ci.yml'], changedFiles: 400 }),
    );
    expect(radius.forRisk).toEqual({ sensitiveAreas: ['ci'], truncated: true });
  });
});
