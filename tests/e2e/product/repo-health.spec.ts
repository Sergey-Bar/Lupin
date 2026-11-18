import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_AUTH_HEADERS, API_BASE, REPORTER_AUTH_HEADERS, WEB_BASE } from '../support/config.js';
import { authenticate } from '../support/session.js';

/**
 * Release journey 1 (`docs/quality/release-journeys.json`, `onboarding`): a QA engineer
 * connects a repository and reads its health grade, and the grade is exactly what the
 * formula in `packages/projects/src/health/grade.ts` says it must be.
 *
 * Each run connects a new folder, so the project has no history and the expected values do
 * not depend on what an earlier run left in the database. The numbers are the formula's, not
 * readings: a clean secret scan and a clean dependency scan measure two dimensions at 100, so
 * the grade is A+ at 100; one open secret trips the hard gate, which holds the score at
 * `GATE_CEILING` (69), a D.
 */

function sarif(tool: string, results: unknown[] = []): string {
  return JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: tool, rules: [] } }, results }],
  });
}

const LEAKED_SECRET = {
  ruleId: 'generic-api-key',
  level: 'error',
  message: { text: 'Detected a generic API key' },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: 'src/config.ts' },
        region: { startLine: 3 },
      },
    },
  ],
};

async function upload(request: APIRequestContext, projectId: string, body: string): Promise<void> {
  const response = await request.post(
    `${API_BASE}/api/v1/projects/${projectId}/health/reports?format=sarif`,
    // The credential a CI job holds, not the installation key.
    { headers: { ...REPORTER_AUTH_HEADERS, 'content-type': 'application/json' }, data: body },
  );
  expect(response.status(), await response.text()).toBe(201);
}

async function expectGrade(
  page: Page,
  projectId: string,
  letter: string,
  score: string,
  limiter: RegExp,
): Promise<void> {
  await page.goto(`${WEB_BASE}/dashboard/repo/${projectId}`);
  await expect(page.getByTestId('repo-health')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('health-letter')).toHaveText(letter);
  await expect(page.getByTestId('health-score')).toHaveText(score);
  await expect(page.getByTestId('health-limiter')).toHaveText(limiter);
}

test.describe('repository health, from connecting a repository to its grade', () => {
  let folder = '';

  test.beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'lupin-health-'));
    writeFileSync(
      path.join(folder, 'package.json'),
      JSON.stringify({ name: path.basename(folder), scripts: { test: 'vitest run' } }),
    );
  });

  test.afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  test('a connected repository is graded exactly, and an open secret caps it at D', async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(90_000);
    await authenticate(context, request);

    // Connect it the way a person does: Settings > Projects, one folder path.
    await page.goto(`${WEB_BASE}/dashboard/settings/projects`);
    await page.getByLabel('Folder path').fill(folder);
    await page.getByRole('button', { name: 'Connect repository' }).click();
    await expect(page.getByTestId('repository-connected')).toBeVisible({ timeout: 15_000 });

    const listed = (await (
      await request.get(`${API_BASE}/api/v1/projects`, { headers: API_AUTH_HEADERS })
    ).json()) as { projects: Array<{ id: string; repoPath?: string | null }> };
    const project = listed.projects.find(
      (entry) =>
        entry.repoPath !== undefined &&
        entry.repoPath !== null &&
        path.resolve(entry.repoPath) === path.resolve(folder),
    );
    expect(project, `a project registered for ${folder}`).toBeDefined();
    const projectId = project?.id ?? '';

    // Nothing measured yet: no grade is invented, and the page says what to run.
    await expectGrade(page, projectId, '—', 'incomplete', /^Security has not been measured/u);

    // A clean secret scan and a clean dependency scan: two dimensions, both 100.
    await upload(request, projectId, sarif('gitleaks'));
    await upload(request, projectId, sarif('osv-scanner'));
    await expectGrade(page, projectId, 'A+', '100 / 100', /.+/u);

    // One leaked key: the open-secret gate holds the grade at the top of the D band.
    await upload(request, projectId, sarif('gitleaks', [LEAKED_SECRET]));
    await expectGrade(
      page,
      projectId,
      'D',
      '69 / 100',
      /^Capped at D — 1 open secret in the repository$/u,
    );
    await expect(page.getByTestId('gate-open-secret')).toContainText('1 open secret');
  });
});
