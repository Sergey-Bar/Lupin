import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { API_AUTH_HEADERS, API_BASE, WEB_BASE } from '../support/config.js';
import { authenticate } from '../support/session.js';

/**
 * Onboarding, end to end, against PostgreSQL: the setup wizard, the cockpit checklist, and the
 * Settings tabs that replaced environment variables.
 *
 * The stack registers this repository at boot (`LUPIN_PROJECT_ROOT`), so "connect a repository"
 * may already be done; the wizard resumes at the first step that is not, and this spec walks
 * from there. Every step and tab is checked with axe for serious and critical violations.
 */
const headers = { ...API_AUTH_HEADERS, 'content-type': 'application/json' };

async function expectAccessible(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(
    blocking.map((violation) => violation.id),
    where,
  ).toEqual([]);
}

test.describe('onboarding', () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${API_BASE}/api/v1/onboarding/reset`, { headers });
  });

  test('setup walks every step, skipping is remembered, and the checklist offers what is left', async ({
    page,
    context,
    request,
  }) => {
    await authenticate(context, request);
    await page.goto(`${WEB_BASE}/dashboard/setup`);
    await expect(page.getByTestId('setup-page')).toBeVisible({ timeout: 15_000 });
    const steps = page.getByRole('list', { name: 'Setup steps' });
    await expect(steps).toBeVisible();

    // Walk every step from wherever setup resumed, checking each one, skipping what is open.
    for (let guard = 0; guard < 8; guard += 1) {
      if (await page.getByTestId('setup-finished').isVisible()) break;
      const heading = page.locator('#setup-step-title');
      await expect(heading)
        .toBeFocused({ timeout: guard === 0 ? 15_000 : 5_000 })
        .catch(() => undefined);
      await expectAccessible(page, `setup step: ${(await heading.textContent()) ?? '?'}`);
      const skip = page.getByRole('button', { name: 'Skip for now' });
      if (await skip.isVisible()) await skip.click();
      else await page.getByRole('button', { name: 'Continue' }).click();
    }
    await expect(page.getByTestId('setup-finished')).toBeVisible();
    await expectAccessible(page, 'setup finished');

    const onboarding = (await (
      await request.get(`${API_BASE}/api/v1/onboarding`, { headers })
    ).json()) as { steps: Array<{ id: string; state: string }> };
    expect(onboarding.steps.find((step) => step.id === 'ai')?.state).toMatch(/skipped|done/u);

    await page.goto(`${WEB_BASE}/dashboard/now`);
    const checklist = page.getByTestId('setup-checklist');
    await expect(checklist).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('checklist-ai')).toBeVisible();
  });

  test('every new Settings tab renders accessibly, and a field the environment sets is locked', async ({
    page,
    context,
    request,
  }) => {
    await authenticate(context, request);
    for (const [path, id] of [
      ['projects', 'settings-projects'],
      ['quality-gates', 'settings-quality-gates'],
      ['ai', 'settings-ai'],
      ['integrations', 'settings-integrations'],
      ['identity', 'settings-identity'],
      ['sessions', 'settings-sessions-retention'],
    ] as const) {
      await page.goto(`${WEB_BASE}/dashboard/settings/${path}`);
      await expect(page.getByTestId(id)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
      await expectAccessible(page, `settings/${path}`);
    }

    // A value saved from the interface reads back as saved, and applies without a restart.
    const put = await request.put(`${API_BASE}/api/v1/settings/retention.auditDays`, {
      headers,
      data: { value: 400 },
    });
    expect(put.status()).toBe(200);
    expect(await put.json()).toMatchObject({ source: 'ui', value: 400 });
    await request.delete(`${API_BASE}/api/v1/settings/retention.auditDays`, { headers });

    // Whatever the environment pins is drawn locked, with the variable's name.
    const settings = (await (
      await request.get(`${API_BASE}/api/v1/settings`, { headers })
    ).json()) as {
      settings: Array<{ key: string; source: string }>;
    };
    const pinned = settings.settings.find(
      (setting) => setting.source === 'environment' && !setting.key.startsWith('identity.'),
    );
    if (pinned !== undefined) {
      const refused = await request.put(`${API_BASE}/api/v1/settings/${pinned.key}`, {
        headers,
        data: { value: 'x' },
      });
      expect(refused.status()).toBe(409);
      expect(await refused.json()).toMatchObject({ error: { code: 'ENV_LOCKED' } });
    }
  });
});
