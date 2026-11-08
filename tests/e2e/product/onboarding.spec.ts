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
    test.setTimeout(120_000);
    await authenticate(context, request);
    await page.goto(`${WEB_BASE}/dashboard/setup`);
    await expect(page.getByTestId('setup-page')).toBeVisible({ timeout: 15_000 });

    // Walk every step from wherever setup resumed, checking each one, skipping what is open.
    const finished = page.getByTestId('setup-finished');
    const heading = page.locator('#setup-step-title');
    const seen: string[] = [];
    for (let guard = 0; guard < 8; guard += 1) {
      // Either the next step or the end: wait for one, rather than racing the render.
      await expect(heading.or(finished)).toBeVisible({ timeout: 15_000 });
      if (await finished.isVisible()) break;
      const title = (await heading.textContent()) ?? '?';
      seen.push(title);
      await expectAccessible(page, `setup step: ${title}`);
      const footer = page.getByRole('button', { name: /^(Skip for now|Continue)$/u });
      await footer.click();
      // The next step replaces this one; wait for the title to change before reading it again.
      await expect(heading.or(finished)).not.toHaveText(title, { timeout: 15_000 });
    }
    await expect(finished).toBeVisible();
    await expectAccessible(page, 'setup finished');
    expect(seen.length, `steps walked: ${seen.join(', ')}`).toBeGreaterThan(0);

    const onboarding = (await (
      await request.get(`${API_BASE}/api/v1/onboarding`, { headers })
    ).json()) as { steps: Array<{ id: string; state: string }> };
    expect(onboarding.steps.find((step) => step.id === 'notifications')?.state).toMatch(
      /skipped|done/u,
    );

    await page.goto(`${WEB_BASE}/dashboard/now`);
    await expect(page.getByTestId('setup-checklist')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('checklist-notifications')).toBeVisible();
    await expectAccessible(page, 'cockpit with the checklist');
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

    const settings = (await (
      await request.get(`${API_BASE}/api/v1/settings`, { headers })
    ).json()) as { settings: Array<{ key: string; source: string }> };

    // A value saved from the interface reads back as saved. The key is one the environment does
    // not pin, so the spec holds whatever a developer's `.env` sets.
    const free = [
      'retention.sseReplayHours',
      'retention.auditDays',
      'integrations.deliverySyncIntervalMs',
    ]
      .map((key) => settings.settings.find((setting) => setting.key === key))
      .find((setting) => setting !== undefined && setting.source !== 'environment');
    expect(free, 'a numeric setting the environment does not pin').toBeDefined();
    const key = free?.key ?? '';
    const value = key === 'integrations.deliverySyncIntervalMs' ? 120_000 : 48;
    const put = await request.put(`${API_BASE}/api/v1/settings/${key}`, {
      headers,
      data: { value },
    });
    expect(put.status()).toBe(200);
    expect(await put.json()).toMatchObject({ source: 'ui', value });
    await request.delete(`${API_BASE}/api/v1/settings/${key}`, { headers });

    // Whatever the environment pins is refused, naming its variable, and drawn locked.
    const pinned = settings.settings.find(
      (setting) => setting.source === 'environment' && setting.key.startsWith('ai.'),
    );
    if (pinned !== undefined) {
      const refused = await request.put(`${API_BASE}/api/v1/settings/${pinned.key}`, {
        headers,
        data: { value: 'https://elsewhere.test' },
      });
      expect(refused.status()).toBe(409);
      expect(await refused.json()).toMatchObject({ error: { code: 'ENV_LOCKED' } });
      await page.goto(`${WEB_BASE}/dashboard/settings/ai`);
      await expect(page.getByTestId(`locked-${pinned.key}`)).toContainText('Set by environment');
    }
  });
});
