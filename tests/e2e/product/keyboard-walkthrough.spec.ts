import { expect, test } from '@playwright/test';
import { WEB_BASE } from '../support/config.js';

/**
 * The primary routes can be used without a pointer.
 *
 * The unit tests prove `Shortcuts` against jsdom's `KeyboardEvent`. This proves the
 * shipped bundle in a real browser, where focus, `<dialog>` and `:focus-visible` belong to
 * the engine. Three claims, one per describe block:
 *
 * 1. each `g` chord lands on its route, and the chord times out rather than waiting forever;
 * 2. a keystroke typed into a field never navigates;
 * 3. the first `Tab` on every primary route reaches a control that shows where focus is.
 */

const ROUTES = [
  { key: 'n', path: '/dashboard/now' },
  { key: 'p', path: '/dashboard/portfolio' },
  { key: 'r', path: '/dashboard/runs' },
  { key: 'i', path: '/dashboard/insights' },
  { key: 's', path: '/dashboard/reports' },
  { key: 'a', path: '/dashboard/access' },
] as const;

test.describe('go-to chords', () => {
  for (const route of ROUTES) {
    test(`g ${route.key} goes to ${route.path}`, async ({ page }) => {
      // Start somewhere else, so landing on the target is a change and not a coincidence.
      await page.goto(
        `${WEB_BASE}${route.path === '/dashboard/now' ? '/dashboard/access' : '/dashboard/now'}`,
      );
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      await page.keyboard.press('g');
      await page.keyboard.press(route.key);
      await expect(page).toHaveURL(`${WEB_BASE}${route.path}`);
    });
  }

  test('a second key after the chord window does nothing', async ({ page }) => {
    await page.goto(`${WEB_BASE}/dashboard/now`);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('g');
    await page.waitForTimeout(1_200);
    await page.keyboard.press('a');
    await expect(page).toHaveURL(`${WEB_BASE}/dashboard/now`);
  });

  test('? opens the shortcut sheet and Escape closes it', async ({ page }) => {
    await page.goto(`${WEB_BASE}/dashboard/now`);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('?');
    const sheet = page.getByTestId('shortcuts-help');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('g n')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });
});

test.describe('typing', () => {
  test('keys typed into a field are the field’s, not the page’s', async ({ page }) => {
    await page.goto(`${WEB_BASE}/dashboard/now`);
    // A field the page owns, so this does not depend on which screen has one.
    await page.evaluate(() => {
      const field = document.createElement('input');
      field.setAttribute('data-testid', 'probe-field');
      document.body.appendChild(field);
    });
    const field = page.getByTestId('probe-field');
    await field.focus();
    await page.keyboard.type('gpa');
    await expect(field).toHaveValue('gpa');
    await expect(page).toHaveURL(`${WEB_BASE}/dashboard/now`);
  });
});

test.describe('rows', () => {
  test('j and k walk the rows of the page and never the navigation', async ({ page }) => {
    await page.goto(`${WEB_BASE}/dashboard/now`);
    await expect(page.locator('[data-page]')).toBeVisible();
    // The rows a screen shows depend on the data behind it. The key handling is the
    // subject here, so give `[data-page]` a list of known size.
    await page.evaluate(() => {
      const list = document.createElement('ul');
      list.setAttribute('data-testid', 'probe-rows');
      for (const label of ['one', 'two', 'three']) {
        const row = document.createElement('li');
        row.textContent = label;
        list.appendChild(row);
      }
      document.querySelector('[data-page]')?.appendChild(list);
    });
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    const rows = page.getByTestId('probe-rows').locator('li');
    const focusedRowText = () =>
      page.evaluate(() => document.activeElement?.closest('li')?.textContent ?? '');

    // The page's own rows come first in document order, so walk to the probe list.
    const total = await page.evaluate(
      () => document.querySelectorAll('[data-page] li, [data-page] tbody tr').length,
    );
    for (let step = 0; step < total; step += 1) await page.keyboard.press('j');
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press('k');
    await expect(rows.nth(1)).toBeFocused();
    expect(await focusedRowText()).toBe('two');
    // The ends clamp rather than wrap.
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await expect(rows.nth(2)).toBeFocused();
  });
});

test.describe('focus', () => {
  for (const route of ROUTES) {
    test(`${route.path}: the first Tab reaches a control and shows focus`, async ({ page }) => {
      await page.goto(`${WEB_BASE}${route.path}`);
      await expect(page.locator('[data-page]')).toBeVisible();
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        if (element === null || element === document.body) return null;
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
          ring: style.boxShadow !== 'none',
          visible: element.matches(':focus-visible'),
        };
      });
      expect(focus, 'Tab must move focus off the document body').not.toBeNull();
      expect(focus?.visible, 'keyboard focus must match :focus-visible').toBe(true);
      expect(
        focus?.outline === true || focus?.ring === true,
        'a focused control must draw an outline or ring',
      ).toBe(true);
    });
  }
});
