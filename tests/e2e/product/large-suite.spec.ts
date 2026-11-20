import { expect, test } from '@playwright/test';
import { largeJunit } from '../support/large-junit.js';
import { API_AUTH_HEADERS, API_BASE, REPORTER_AUTH_HEADERS } from '../support/config.js';
import { registerTempProject, type TempProject } from '../support/temp-project.js';

/**
 * A CI suite at real-world size (ledger REL-4): fifty thousand tests is one JUnit report of
 * about 6.4 MiB, which the upload door refused at a 5 MiB ceiling, so `lupin test` could not
 * record the suites the product is for. The ceiling and the time below are the recorded ones,
 * and a regression past either fails.
 */
const TESTS = 50_000;
const FAILED = Math.ceil(TESTS / 97);
/**
 * Observed 6.7 s on 2026-11-18 (Windows workstation, PostgreSQL 16 in Docker), held at about 3x for
 * slower CI runners. Before the batched write it did not finish in 120 s.
 */
const CEILING_MS = 20_000;

test.describe('a fifty-thousand-test suite', () => {
  let project: TempProject;
  test.beforeEach(async ({ request }) => {
    project = await registerTempProject(request, 'lupin-large');
  });
  test.afterEach(async ({ request }) => project.remove(request));

  test('is ingested whole, every test counted, within the recorded time', async ({ request }) => {
    test.setTimeout(CEILING_MS * 2);
    const report = Buffer.from(largeJunit(TESTS, new Date().toISOString()));
    expect(report.byteLength).toBeGreaterThan(5 * 1024 * 1024);
    const started = Date.now();
    const response = await request.post(
      `${API_BASE}/api/v1/projects/${project.id}/tests/reports?format=junit&branch=main&startedAt=${encodeURIComponent(new Date().toISOString())}`,
      {
        headers: { ...REPORTER_AUTH_HEADERS, 'content-type': 'application/octet-stream' },
        data: report,
        timeout: CEILING_MS * 2,
      },
    );
    const elapsed = Date.now() - started;
    expect(response.status(), (await response.text()).slice(0, 500)).toBe(200);
    const verdict = (await response.json()) as {
      runId: string;
      tests: { total: number; failed: number };
    };
    expect(verdict.tests).toMatchObject({ total: TESTS, failed: FAILED });
    console.log(
      `large-suite: ${String(TESTS)} tests, ${String(report.byteLength)} bytes, ${String(elapsed)} ms`,
    );
    expect(elapsed).toBeLessThan(CEILING_MS);

    const run = (await (
      await request.get(`${API_BASE}/api/v1/runs/${verdict.runId}`, { headers: API_AUTH_HEADERS })
    ).json()) as { summary: { total: number; failed: number } };
    expect(run.summary).toMatchObject({ total: TESTS, failed: FAILED });
  });
});
