import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_AUTH_HEADERS, API_BASE, REPORTER_AUTH_HEADERS, WEB_BASE } from '../support/config.js';
import { authenticate } from '../support/session.js';
import { registerTempProject, type TempProject } from '../support/temp-project.js';

/**
 * Release journey 3 (`docs/quality/release-journeys.json`, `release-verdict`): Home's verdict
 * follows what CI just reported.
 *
 * Each CI upload is judged by the quality gate, and the newest judged run is the gate reason on
 * Home. So after a green upload the gate reason passes, and after a red one Home says No-go and
 * lists the failing branch under what needs you. The other readiness inputs (pass rate over the
 * window, workspace quarantine, runs that name no project) are shared with the rest of this
 * suite, so this spec holds Home to the API's own card rather than to a fixed word for them;
 * the exact go, caution and no-go rules are pinned in `apps/api/src/routes/projects.test.ts`.
 */

interface Card {
  verdict: 'go' | 'caution' | 'no-go';
  reasons: Array<{ code: string; level: string; message: string }>;
}

const WORD = { go: 'Ready', caution: 'Caution', 'no-go': 'No-go' } as const;

function junit(stamp: string, failing: boolean): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites><testsuite name="checkout" tests="1" failures="${failing ? 1 : 0}" timestamp="${stamp}">`,
    '<testcase classname="checkout" name="pays by card" file="tests/pay.test.ts" time="0.01">',
    failing ? '<failure message="card declined">AssertionError</failure>' : '',
    '</testcase></testsuite></testsuites>',
  ].join('');
}

async function upload(
  request: APIRequestContext,
  projectId: string,
  branch: string,
  failing: boolean,
) {
  const query = new URLSearchParams({
    format: 'junit',
    branch,
    startedAt: new Date().toISOString(),
  });
  const response = await request.post(
    `${API_BASE}/api/v1/projects/${projectId}/tests/reports?${query.toString()}`,
    {
      headers: { ...REPORTER_AUTH_HEADERS, 'content-type': 'application/octet-stream' },
      data: Buffer.from(junit(new Date().toISOString(), failing)),
    },
  );
  expect(response.status(), await response.text()).toBe(200);
}

async function card(request: APIRequestContext, projectId: string): Promise<Card> {
  const response = await request.get(`${API_BASE}/api/v1/projects/${projectId}/readiness?days=7`, {
    headers: API_AUTH_HEADERS,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Card;
}

async function openHome(page: Page, projectId: string): Promise<void> {
  // The project chosen in the sidebar, and setup put off with "Do this later": a person who
  // has set up and come back to Home.
  await page.addInitScript((id) => {
    window.localStorage.setItem('lupin-project', id);
    window.localStorage.setItem('lupin-setup-later', '1');
  }, projectId);
  await page.goto(`${WEB_BASE}/dashboard/now`);
  await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 15_000 });
}

test.describe('the release verdict on Home', () => {
  let project: TempProject;
  let projectId = '';

  test.beforeEach(async ({ request }) => {
    project = await registerTempProject(request, 'lupin-verdict');
    projectId = project.id;
  });

  test.afterEach(async ({ request }) => project.remove(request));

  test('a green upload passes the gate, a red one turns Home to No-go and names the branch', async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(90_000);
    await authenticate(context, request);
    const branch = `feat/pay-${String(Date.now())}`;

    await upload(request, projectId, branch, false);
    const green = await card(request, projectId);
    expect(green.reasons.find((reason) => reason.code === 'gate')).toMatchObject({
      level: 'go',
      message: 'The latest quality gate passed',
    });
    await openHome(page, projectId);
    const hero = page.locator('section[data-verdict]').first();
    await expect(hero).toHaveAttribute('data-verdict', green.verdict);
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText(WORD[green.verdict]);

    await upload(request, projectId, branch, true);
    const red = await card(request, projectId);
    expect(red.verdict).toBe('no-go');
    expect(red.reasons.find((reason) => reason.code === 'gate')).toMatchObject({
      level: 'no-go',
      message: 'The latest quality gate failed',
    });
    await page.reload();
    await expect(hero).toHaveAttribute('data-verdict', 'no-go');
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText('No-go');
    await expect(hero).toContainText(red.reasons[0]?.message ?? '');
    // What needs you: the branch the red upload was for, newest finished run first.
    await expect(page.getByText(`1 test failing on ${branch}`)).toBeVisible();
  });
});
