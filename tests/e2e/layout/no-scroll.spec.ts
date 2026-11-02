/**
 * The no-scroll contract, measured on every route.
 *
 * ## What is claimed
 *
 * From the `lg` breakpoint (1024px) up, **no page scrolls**: the document is exactly the
 * viewport, `<main>` holds its content without an overflowing scrollbar, and any list that
 * can grow is paged or scrolls inside its own panel. Below `lg` the panels stack and the
 * page may scroll, because WCAG 1.4.10 asks for reflow and clipping would hide content.
 * `__root.tsx` keeps `overflow-y-auto` on `<main>` as that floor, which is exactly why this
 * file exists: the floor also *hides* a page that overflows at desktop width, since nothing
 * fails when a page quietly grows a scrollbar.
 *
 * ## Why the data is seeded
 *
 * An empty workspace renders short empty states, and a short page never overflows, so a
 * run against nothing would report the contract held on every route while measuring none
 * of the screens it exists for. The spec registers a project and reports thirty runs
 * first, so the run, insight and portfolio lists are longer than any viewport tested.
 * GitHub-backed screens (`/dashboard/prs`, issues, repositories) need a connected
 * installation and are not seeded here; the reference page work owns a fixture for them.
 *
 * ## The route list is derived
 *
 * From `routeManifest`, as `accessibility/routes.spec.ts` does, with the same sentinel
 * table for `:param` segments. A hand-written list would be a second list, and a second
 * list is how a route ends up reachable and unmeasured.
 *
 * ## The measurement
 *
 * Two numbers per page. `main.scrollHeight - main.clientHeight` is how far the shell's
 * scroll container overflows, and `documentElement.scrollHeight - innerHeight` is how far
 * the document does. Both must be at most one pixel, which absorbs sub-pixel rounding and
 * nothing else. Horizontal overflow is measured the same way, because a page that is
 * wider than the viewport is a scroll in the other direction.
 *
 * Motion is off for the project (`playwright.config.ts`), so a panel mid-way through its
 * entrance animation cannot report a height it will not have a frame later.
 *
 * ## Evidence
 *
 * `UI_AUDIT_SHOTS=1` also saves a screenshot of every route, viewport and theme under
 * `test-results/evidence/ui-audit/`, which is what the audit rubric is scored from. The
 * measurement is the gate; the pictures are for a person.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { routeManifest } from '../../../apps/web/src/route-manifest.js';
import { postReporterEvent, reportTest, uniqueRunId } from '../support/api.js';
import { API_AUTH_HEADERS, API_BASE, WEB_BASE } from '../support/config.js';
import { mockGithubInbox } from '../support/github-fixture.js';
import { authenticate } from '../support/session.js';

/** Every width and height is at or above `lg`; the contract does not apply below it. */
const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;

const SHOTS = process.env['UI_AUDIT_SHOTS'] === '1';
const THEMES = SHOTS ? (['dark', 'light'] as const) : (['dark'] as const);

/** Sub-pixel rounding is the only slack. Anything larger is a scrollbar a person can reach. */
const TOLERANCE_PX = 1;

/**
 * Parameter values, as in `accessibility/routes.spec.ts`. Valid v4 UUIDs, because the ids are
 * UUIDs and a malformed one is rejected by the database before the route can render.
 *
 * A new `:param` throws instead of defaulting: a substituted guess would measure a screen
 * other than the one the parameter names.
 */
const SENTINELS: Record<string, string> = {
  runId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  metricId: 'coverage',
};

function concretePath(template: string): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const sentinel = SENTINELS[name];
    if (sentinel === undefined) {
      throw new Error(`${template} has a ":${name}" parameter with no sentinel in SENTINELS.`);
    }
    return sentinel;
  });
}

const ROUTES = routeManifest.map((route) => ({ id: route.id, path: concretePath(route.path) }));

const EVIDENCE_DIR = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'test-results',
  'evidence',
  'ui-audit',
);

interface Overflow {
  /** Pixels `<main>` holds beyond what it shows. */
  readonly mainY: number;
  /** Pixels `<main>` is wider than it shows. */
  readonly mainX: number;
  /** Pixels the document is taller than the viewport. */
  readonly documentY: number;
  /** Pixels the document is wider than the viewport. */
  readonly documentX: number;
  /** When the page overflows: the elements that reach furthest past the viewport. */
  readonly culprits: readonly string[];
}

/** Read the four overflow numbers from the page, and name what causes them. */
async function measure(page: Page): Promise<Overflow> {
  return page.evaluate((): Overflow => {
    const main = document.querySelector('main');
    const root = document.documentElement;
    const numbers = {
      mainY: main === null ? 0 : main.scrollHeight - main.clientHeight,
      mainX: main === null ? 0 : main.scrollWidth - main.clientWidth,
      documentY: root.scrollHeight - window.innerHeight,
      documentX: root.scrollWidth - window.innerWidth,
    };
    if (Math.max(...Object.values(numbers)) <= 1) return { ...numbers, culprits: [] };

    /** An ancestor that clips or scrolls its content hides what overflows it. */
    const clipped = (element: Element): boolean => {
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(hidden|auto|scroll|clip)/.test(`${style.overflowY} ${style.overflowX}`)) {
          const box = node.getBoundingClientRect();
          const own = element.getBoundingClientRect();
          if (own.bottom > box.bottom + 1 || own.right > box.right + 1) return true;
        }
      }
      return false;
    };
    const describe = (element: Element): string => {
      const id = element.getAttribute('data-testid');
      const classes = (element.getAttribute('class') ?? '').split(/\s+/).slice(0, 4).join('.');
      return `${element.tagName.toLowerCase()}${id === null ? '' : `[${id}]`}${classes === '' ? '' : `.${classes}`}`;
    };
    const reaching = [...document.body.querySelectorAll('*')]
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(
        ({ element, box }) =>
          box.height > 0 &&
          (box.bottom > window.innerHeight + 1 || box.right > window.innerWidth + 1) &&
          (!clipped(element) || getComputedStyle(element).position === 'absolute') &&
          getComputedStyle(element).position !== 'fixed',
      )
      .sort((a, b) => b.box.bottom - a.box.bottom)
      .slice(0, 3)
      .map(({ element, box }) => `${describe(element)} (bottom ${String(Math.round(box.bottom))})`);
    return { ...numbers, culprits: reaching };
  });
}

/**
 * The page rendered something, so a route that failed to mount cannot pass by being empty.
 * An empty `<main>` has no overflow, and the same blank screen is how the axe gate was
 * once green over a route that rendered nothing.
 */
async function expectRendered(page: Page, where: string): Promise<void> {
  const main = page.locator('main');
  await expect(main, `${where} rendered no <main>`).toBeVisible({ timeout: 15_000 });
  // The first child of <main> is the zero-height section-tab wrapper, which is never visible, so
  // "any descendant" would call every route empty. Look for page content outside the chrome. A
  // loading or failed state counts: it is a state the route renders, and it is still measured.
  await expect(
    main
      .locator(
        ':is(h1, h2, section, p, ul, ol, table, form, dl, [role="status"], [role="alert"]):not([data-chrome="secondary"] *)',
      )
      .first(),
    `${where} rendered no page content, which passes the overflow check by having nothing in it`,
  ).toBeVisible();
}

/** Wait for the page to stop fetching, then one frame so layout has settled. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

let seeded = false;

/**
 * A project and thirty runs, so list screens are longer than the shortest viewport.
 *
 * The project is registered through the endpoint the onboarding screen points a reader at,
 * and a `409` is not a failure: `reset-queue.mjs` deliberately leaves `projects` alone.
 */
async function seedWorkspace(request: APIRequestContext): Promise<void> {
  if (seeded) return;
  seeded = true;

  const registered = await request.post(`${API_BASE}/api/v1/projects`, {
    headers: API_AUTH_HEADERS,
    data: {
      name: 'UI audit fixture',
      slug: 'ui-audit-fixture',
      repoPath: path.join(import.meta.dirname, '..', '..', '..'),
    },
  });
  expect(
    [201, 409],
    `the audit needs a project to render a dashboard: ${String(registered.status())}`,
  ).toContain(registered.status());

  for (let index = 0; index < 30; index += 1) {
    const failed = index % 4 === 0;
    const runId = uniqueRunId();
    await postReporterEvent(request, {
      type: 'run:start',
      runId,
      payload: { total: 3, branch: index % 3 === 0 ? 'main' : `feat/audit-${String(index)}` },
    });
    for (const [offset, status] of (
      ['passed', failed ? 'failed' : 'passed', 'passed'] as const
    ).entries()) {
      await reportTest(request, runId, {
        testId: `${runId}-${String(offset)}`,
        title: `audit fixture test ${String(index)}.${String(offset)}`,
        file: `audit-${String(index % 5)}.spec.ts`,
        status,
        durationMs: 40 + index,
      });
    }
    await postReporterEvent(request, {
      type: 'run:end',
      runId,
      payload: {
        status: failed ? 'failed' : 'passed',
        passed: failed ? 2 : 3,
        failed: failed ? 1 : 0,
        branch: 'main',
      },
    });
  }
}

test.describe('no-scroll contract at lg and above', () => {
  test.beforeAll(async ({ request }) => {
    await seedWorkspace(request);
  });

  test.beforeEach(async ({ context, request }) => {
    await authenticate(context, request);
  });

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) {
        test(`${route.id} fits ${viewport.name} in the ${theme} theme`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.addInitScript((value) => {
            window.localStorage.setItem('lupin-theme', value);
          }, theme);
          // The GitHub inbox needs an installation a fresh database lacks; without a fixture
          // these routes render their short empty states and pass by being short.
          if (route.id === 'prs' || route.id === 'issues') await mockGithubInbox(page);
          await page.goto(`${WEB_BASE}${route.path}`);

          const where = `${route.path} at ${viewport.name} in the ${theme} theme`;
          await expectRendered(page, where);
          await settle(page);

          const overflow = await measure(page);

          if (SHOTS) {
            mkdirSync(EVIDENCE_DIR, { recursive: true });
            await page.screenshot({
              path: path.join(EVIDENCE_DIR, `${route.id}--${viewport.name}--${theme}.png`),
            });
            writeFileSync(
              path.join(EVIDENCE_DIR, `${route.id}--${viewport.name}--${theme}.json`),
              JSON.stringify(
                { route: route.path, viewport: viewport.name, theme, overflow },
                null,
                2,
              ),
            );
          }

          expect(
            Math.max(overflow.mainY, overflow.mainX, overflow.documentY, overflow.documentX),
            `${where} scrolls (${JSON.stringify(overflow)}). A positive number is pixels held ` +
              'beyond the viewport: lay the page out into the height the shell gives it, and put ' +
              'a scroll region inside the component that can grow. Do not hide it with ' +
              'overflow-hidden on <main>.',
          ).toBeLessThanOrEqual(TOLERANCE_PX);
        });
      }
    }
  }
});
