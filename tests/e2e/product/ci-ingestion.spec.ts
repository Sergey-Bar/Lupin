import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { listRuns } from '../support/api.js';
import { API_AUTH_HEADERS, API_BASE, REPORTER_SECRET, WEB_BASE } from '../support/config.js';
import { packTools, type PackedTools } from '../support/packed-tools.js';
import { authenticate } from '../support/session.js';
import { registerTempProject, type TempProject } from '../support/temp-project.js';

/**
 * Release journey 2 (`docs/quality/release-journeys.json`, `ci-ingestion`): what a CI job
 * does, with the packages a CI job installs.
 *
 * `@lupin/cli` and `@lupin/playwright-reporter` are built, packed and installed from their
 * tarballs into an empty folder, and every call below goes through that install. The CLI
 * authenticates with an uploader token pinned to one project, minted the way Settings mints
 * it; the reporter with the reporter secret, as its README says.
 */

const commit = (n: number) => `${'c0ffee'}${String(n).padStart(6, '0')}`;

function junit(stamp: string, totalsPasses: boolean): string {
  const failure = totalsPasses
    ? ''
    : '<failure message="expected 10, received 9">AssertionError</failure>';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites><testsuite name="checkout" tests="2" failures="${totalsPasses ? 0 : 1}" timestamp="${stamp}">`,
    '<testcase classname="checkout" name="applies the discount" file="tests/checkout.test.ts" time="0.01"/>',
    `<testcase classname="checkout" name="totals the basket" file="tests/checkout.test.ts" time="0.02">${failure}</testcase>`,
    '</testsuite></testsuites>',
  ].join('');
}

function sarif(results: unknown[]): string {
  return JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'semgrep', rules: [] } }, results }],
  });
}

const CRITICAL = {
  ruleId: 'javascript.express.sql-injection',
  level: 'error',
  message: { text: 'User input reaches a SQL query' },
  properties: { 'security-severity': '9.8', tags: ['security'] },
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'src/orders.ts' }, region: { startLine: 12 } } },
  ],
};

test.describe('CI ingestion through the packed CLI and reporter', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let tools: PackedTools;
  let shop: TempProject;
  let projectId = '';
  let token = '';

  test.beforeAll(async ({ request }) => {
    tools = packTools();
    shop = await registerTempProject(request, 'lupin-ci-repo');
    projectId = shop.id;
    token = await mintUploaderToken(request, projectId);
  });

  test.afterAll(async ({ request }) => {
    await shop?.remove(request);
    if (tools?.dir) rmSync(tools.dir, { recursive: true, force: true });
  });

  /** `npx lupin …` in the user's project, with the environment a CI job sets. */
  function lupin(args: string[], extraEnv: Record<string, string> = {}) {
    const result = spawnSync(process.execPath, [tools.cliEntry, ...args], {
      cwd: tools.dir,
      encoding: 'utf8',
      env: {
        ...ciEnv(),
        LUPIN_URL: API_BASE,
        LUPIN_TOKEN: token,
        LUPIN_PROJECT: projectId,
        ...extraEnv,
      },
    });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  }

  test('lupin test uploads JUnit, keeps the suite exit code, and a flip-flopping test is flagged flaky', async ({
    page,
    context,
    request,
  }) => {
    // pass, fail, pass: two flips of one test. Each report differs in bytes (its timestamp),
    // because the server keys a run on the report's digest.
    const outcomes = [true, false, true];
    for (const [index, passes] of outcomes.entries()) {
      const report = `junit-${String(index)}.xml`;
      writeFileSync(
        path.join(tools.dir, report),
        junit(new Date(Date.now() + index * 1000).toISOString(), passes),
      );
      const exit = passes ? 0 : 1;
      const { code, out } = lupin([
        'test',
        '--format',
        'junit',
        '--report',
        report,
        '--branch',
        'main',
        '--commit',
        commit(index),
        '--',
        process.execPath,
        '-e',
        `process.exit(${String(exit)})`,
      ]);
      expect(code, out).toBe(exit);
    }

    const insights = (await (
      await request.get(`${API_BASE}/api/v1/dashboard/insights?days=14&projectId=${projectId}`, {
        headers: API_AUTH_HEADERS,
      })
    ).json()) as { flakyLeaderboard: Array<{ title: string; flips: number; runs: number }> };
    const flaky = insights.flakyLeaderboard.find((entry) => entry.title === 'totals the basket');
    expect(flaky, JSON.stringify(insights.flakyLeaderboard)).toMatchObject({ flips: 2, runs: 3 });
    expect(insights.flakyLeaderboard.some((entry) => entry.title === 'applies the discount')).toBe(
      false,
    );

    await authenticate(context, request);
    // The project the reader chose in the sidebar, which this page is scoped to (`lib/scope.ts`).
    await page.addInitScript((id) => window.localStorage.setItem('lupin-project', id), projectId);
    await page.goto(`${WEB_BASE}/dashboard/insights`);
    await expect(page.getByTestId('insights-flaky')).toContainText('totals the basket', {
      timeout: 15_000,
    });
  });

  test('lupin upload sends a scan, and lupin gate passes clean and fails on a new critical', async () => {
    const write = (name: string, body: string) => writeFileSync(path.join(tools.dir, name), body);
    write('clean.sarif', sarif([]));
    write('critical.sarif', sarif([CRITICAL]));

    const clean = lupin([
      'upload',
      '--format',
      'sarif',
      '--file',
      'clean.sarif',
      '--branch',
      'main',
      '--commit',
      commit(10),
    ]);
    expect(clean.code, clean.out).toBe(0);
    expect(clean.out).toMatch(/Uploaded clean\.sarif as sarif: 0 new finding\(s\)/u);
    const passed = lupin(['gate', '--branch', 'main', '--commit', commit(10)]);
    expect(passed.code, passed.out).toBe(0);
    expect(passed.out).toMatch(/^Gate passed on main/mu);

    // The commit whose own JUnit run failed (the first test's commit(1)) must not pass the gate,
    // however clean its scans: a gate that passes red tests is the one number QA cannot trust.
    const red = lupin(['gate', '--branch', 'main', '--commit', commit(1)]);
    expect(red.code, red.out).toBe(1);
    expect(red.out).toMatch(
      /^- 1 failing test on this commit: tests\/checkout\.test\.ts \u203a checkout \u203a totals the basket$/mu,
    );

    const branch = 'feat/orders-search';
    const risky = lupin([
      'upload',
      '--format',
      'sarif',
      '--file',
      'critical.sarif',
      '--branch',
      branch,
      '--commit',
      commit(11),
    ]);
    expect(risky.code, risky.out).toBe(0);
    const failed = lupin(['gate', '--branch', branch, '--commit', commit(11)]);
    expect(failed.code, failed.out).toBe(1);
    expect(failed.out).toMatch(/Gate failed on feat\/orders-search/u);
    expect(failed.out).toMatch(/^- 1 new critical finding \(at most 0 allowed\)$/mu);
  });

  test('the CLI refuses a token pinned to another project, and says so with exit 4', async ({
    request,
  }) => {
    const other = await registerTempProject(request, 'lupin-ci-other');
    try {
      writeFileSync(path.join(tools.dir, 'clean.sarif'), sarif([]));
      const refused = lupin(
        ['upload', '--format', 'sarif', '--file', 'clean.sarif', '--branch', 'main'],
        {
          LUPIN_PROJECT: other.id,
        },
      );
      expect(refused.code, refused.out).toBe(4);
    } finally {
      await other.remove(request);
    }
  });

  test('the packed Playwright reporter streams a real run, its passes and its failure', async ({
    request,
  }) => {
    const branch = `ci/reporter-${String(Date.now())}`;
    writeFileSync(
      path.join(tools.dir, 'playwright.config.mjs'),
      [
        "import { defineConfig } from '@playwright/test';",
        "export default defineConfig({ testDir: './e2e', reporter: [['@lupin/playwright-reporter']] });",
      ].join('\n'),
    );
    rmSync(path.join(tools.dir, 'e2e'), { recursive: true, force: true });
    const e2e = path.join(tools.dir, 'e2e');
    mkdirSync(e2e, { recursive: true });
    writeFileSync(
      path.join(e2e, 'cart.spec.mjs'),
      [
        "import { test, expect } from '@playwright/test';",
        "test('adds an item', () => { expect(1 + 1).toBe(2); });",
        "test('removes an item', () => { expect(2 - 1).toBe(0); });",
      ].join('\n'),
    );
    const result = spawnSync(
      process.execPath,
      [tools.playwrightCli, 'test', '--config', 'playwright.config.mjs'],
      {
        cwd: tools.dir,
        encoding: 'utf8',
        env: {
          ...ciEnv(),
          LUPIN_URL: API_BASE,
          LUPIN_REPORTER_SECRET: REPORTER_SECRET,
          LUPIN_BRANCH: branch,
        },
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status, output).toBe(1);
    expect(output).not.toMatch(/Lupin reporter:/u);

    await expect
      .poll(async () => (await listRuns(request)).find((run) => run.branch === branch)?.phase, {
        timeout: 30_000,
      })
      .toBe('complete');
    const run = (await listRuns(request)).find((entry) => entry.branch === branch);
    expect(run?.outcome).toBe('failed');
    expect(run?.summary).toMatchObject({ total: 2, passed: 1, failed: 1 });
  });
});

/** The environment a CI job would give the tools, without this suite's own Playwright state. */
function ciEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(PW_|PLAYWRIGHT_|TEST_|LUPIN_|GITHUB_|CI_)/u.test(key),
    ),
  );
}

async function mintUploaderToken(request: APIRequestContext, projectId: string): Promise<string> {
  const response = await request.post(`${API_BASE}/api/v1/access-tokens`, {
    headers: { ...API_AUTH_HEADERS, 'content-type': 'application/json' },
    data: { name: 'ci-ingestion e2e', role: 'uploader', projectId, expiresInDays: 1 },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { token?: unknown };
  expect(typeof body.token === 'string' && body.token.startsWith('lup_'), 'an lup_ token').toBe(
    true,
  );
  return String(body.token);
}
