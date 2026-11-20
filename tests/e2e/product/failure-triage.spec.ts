import { expect, test } from '@playwright/test';
import { API_AUTH_HEADERS, API_BASE, REPORTER_AUTH_HEADERS, WEB_BASE } from '../support/config.js';
import { authenticate } from '../support/session.js';
import { registerTempProject, type TempProject } from '../support/temp-project.js';

/**
 * Release journey 6 (`docs/quality/release-journeys.json`, `triage`): forty failures from three
 * causes read as three causes. The signature is deterministic (`failureSignature` in
 * `packages/reporting`), so the volatile parts of each message — the order id, the timeout, the
 * line number — never split one cause into many; no model is involved.
 */
const CAUSES = [
  (n: number) =>
    `TimeoutError: locator.click: Timeout ${String(30_000 + n)}ms exceeded waiting for #pay-${String(n)}`,
  (n: number) =>
    `AssertionError: expected order ${String(1000 + n)} total 10.00, received 9.${String(n % 10)}0`,
  (n: number) =>
    `TypeError: Cannot read properties of undefined (reading 'sku') at cart.ts:${String(40 + n)}:12`,
];
const SPLIT = [20, 12, 8];

function junit(): string {
  const cases: string[] = [];
  let index = 0;
  SPLIT.forEach((count, cause) => {
    for (let n = 0; n < count; n += 1) {
      const message = (CAUSES[cause] as (n: number) => string)(n);
      cases.push(
        `<testcase classname="shop" name="case ${String(index)}" file="tests/shop.test.ts" time="0.01"><failure message="${message.replace(/"/gu, '&quot;')}">${message}</failure></testcase>`,
      );
      index += 1;
    }
  });
  return `<?xml version="1.0"?><testsuites><testsuite name="shop" tests="${String(index)}" failures="${String(index)}">${cases.join('')}</testsuite></testsuites>`;
}

test.describe('failure triage', () => {
  let project: TempProject;
  test.beforeEach(async ({ request }) => {
    project = await registerTempProject(request, 'lupin-triage');
  });
  test.afterEach(async ({ request }) => project.remove(request));

  test('forty failures from three causes are three causes, biggest first', async ({
    page,
    context,
    request,
  }) => {
    const upload = await request.post(
      `${API_BASE}/api/v1/projects/${project.id}/tests/reports?format=junit&branch=main&startedAt=${encodeURIComponent(new Date().toISOString())}`,
      {
        headers: { ...REPORTER_AUTH_HEADERS, 'content-type': 'application/octet-stream' },
        data: Buffer.from(junit()),
      },
    );
    expect(upload.status(), await upload.text()).toBe(200);

    const insights = (await (
      await request.get(`${API_BASE}/api/v1/dashboard/insights?days=14&projectId=${project.id}`, {
        headers: API_AUTH_HEADERS,
      })
    ).json()) as {
      failureClusters?: {
        totals: { failures: number; causes: number };
        clusters: Array<{ count: number; errorType: string | null; sampleMessage: string }>;
      };
    };
    const clusters = insights.failureClusters;
    expect(clusters, 'the insights carry failure clusters').toBeDefined();
    // Other specs' runs that name no project count toward every project, so this upload's causes
    // are found by their own messages; each must be exactly its size, biggest first.
    const OWN = [/waiting for #pay-/u, /expected order \d+ total/u, /reading 'sku'/u];
    const mine = (clusters?.clusters ?? []).filter((cluster) =>
      OWN.some((pattern) => pattern.test(cluster.sampleMessage)),
    );
    expect(mine.map((cluster) => [cluster.errorType, cluster.count])).toEqual([
      ['TimeoutError', 20],
      ['AssertionError', 12],
      ['TypeError', 8],
    ]);

    await authenticate(context, request);
    await page.addInitScript((id) => window.localStorage.setItem('lupin-project', id), project.id);
    await page.goto(`${WEB_BASE}/dashboard/insights`);
    await expect(page.getByText(/TimeoutError/u).first()).toBeVisible({ timeout: 15_000 });
  });
});
