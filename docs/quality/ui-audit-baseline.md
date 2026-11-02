# UI audit baseline: the no-scroll contract

Recorded 2026-11-02, before any layout change, by
`tests/e2e/layout/no-scroll.spec.ts` (Playwright project `layout-fit`).

The contract: from `lg` (1024px) up, no page scrolls. `<main>` and the document fit the
viewport, and any list that can grow scrolls or pages inside its own panel. Below `lg` the
panels stack and the page may scroll.

## Result

210 tests (35 routes, 3 viewports, 2 themes): **158 passed, 52 failed**.

- 46 failures are real overflow, on 11 routes.
- 6 failures are `/dashboard/repos/:projectId`, which rendered no page content for an
  unregistered repository. The spec could not measure it, which is a finding in itself.

Worst overflow in pixels beyond the viewport, dark theme (light is identical):

| Route                        | Worst overflow | Fails at                      |
| ---------------------------- | -------------- | ----------------------------- |
| `/dashboard/delivery`        | 1287           | 1280x720, 1440x900, 1920x1080 |
| `/dashboard/ai-code`         | 1201           | 1280x720, 1440x900, 1920x1080 |
| `/dashboard`                 | 1117           | 1280x720, 1440x900, 1920x1080 |
| `/dashboard/now`             | 681            | 1280x720, 1440x900, 1920x1080 |
| `/dashboard/supply-chain`    | 644            | 1280x720, 1440x900, 1920x1080 |
| `/dashboard/deployment`      | 344            | 1280x720, 1440x900            |
| `/dashboard/portfolio`       | 232            | 1280x720, 1440x900            |
| `/dashboard/access`          | 104            | 1280x720                      |
| `/dashboard/reports`         | 55             | 1280x720                      |
| `/dashboard/runs`            | 25             | 1280x720                      |
| `/dashboard/metric/coverage` | 2              | 1280x720                      |

The other 23 routes fit at every size. Every overflow is vertical; none is horizontal.

## What this baseline does not cover

- `/dashboard/prs`, `/dashboard/issues` and `/dashboard/repos` need a connected GitHub
  installation. They fit here only because they render their empty states. A fixture with
  real pull requests belongs to the PR reference-page work.
- Only the overflow criterion is scored. Hierarchy, density, state coverage, motion and RTL
  are scored from the screenshots written by `UI_AUDIT_SHOTS=1`, in
  `test-results/evidence/ui-audit/` (not committed).

## Running it

The suite needs a PostgreSQL URL that `scripts/lib/e2e-database-guard.mjs` accepts (a
loopback host, or a database named test, e2e or ci).

```powershell
$env:DATABASE_URL = '<loopback postgres url>'
$env:E2E_API_PORT = '3111'   # keep clear of a dev API on 3000
$env:E2E_WEB_PORT = '5273'   # keep clear of a dev web server on 5173
$env:UI_AUDIT_SHOTS = '1'    # optional: screenshots and per-page JSON
pnpm exec playwright test --project=layout-fit
```

Two things in a developer checkout break a first run, and neither is a product defect:

1. A `REPORTER_SECRET` in the repository `.env` is loaded by the API, so the spec's reporter
   events are refused with `INVALID_REPORTER_TOKEN`. Start the API with `REPORTER_SECRET`
   set to the suite's installation key, or run where no `.env` exists.
2. The Vite dev server used to ignore `E2E_WEB_PORT` and `E2E_API_PORT`, so an overridden
   suite talked to the developer's own servers. `playwright.config.ts` now passes both.

## After the first pass (2026-11-02)

Same spec, same seeded workspace, plus a pull request and issue fixture
(`tests/e2e/support/github-fixture.ts`) so the GitHub screens are measured with rows.

- No-scroll contract: **210 of 210** pass (35 routes, 3 sizes, 2 themes).
- Axe over every route, both themes, four data states: **212 of 212** pass.
- Rendering budget (`pnpm test:render`): passes. LCP 220 to 236 ms, CLS 0.000, glass depth 0.
- Gate meta-tests (`pnpm test:integration`): 975 pass, 0 fail, 3 skipped.

What the pass fixed that the baseline did not list:

- The theme was applied after the first paint, so a saved light theme flashed dark and every
  element transitioned. `apps/web/index.html` now sets `data-theme` before first paint.
- Loading states drew only hidden skeletons, so a screen reader heard nothing and a browser
  sweep saw a blank page on twelve routes. They now carry `role="status"`.
- The insights charts collapsed under their labels in fixed-height cells. They now keep a
  minimum height and scroll inside their panel.
- The project switcher and five more controls were raw `<select>` elements in a different
  style. They use the one `Select`.

Not done: the per-page rubric score, the row-to-detail shared-element morph, `j`/`k` in the new
rows, and a visual pass over every page beyond those listed above. `packages/connectors/github`
is at 99.57% statements against a recorded floor of 100 (line 779); that package is not touched
by this work.
