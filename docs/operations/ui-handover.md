# UI upgrade: handover

What changed in the web app (`apps/web`) and the component library (`packages/ui`), how to
check it, and what is not finished. Written for whoever takes the product over.

## What a reader of the product gets

- **No page scrolls from 1024px wide up.** Long pages keep their header fixed and scroll their
  body; charts and tables scroll inside their own panel. Below 1024px the panels stack and the
  page scrolls, as reflow requires.
- **Motion that reports a change.** Lists arrive in order, the accent mark slides between the
  navigation sections, tabs and segments, figures count to their value, a selection re-animates
  its detail, and the menu opens from its button. All of it stops under the operating system's
  reduced-motion setting and under the product's own **Reduce motion** setting.
- **One set of controls.** A styled `Checkbox`, a `MenuButton` for a row's actions, and the one
  `Select` everywhere. Six raw browser selects were replaced.
- **The right theme on the first frame.** A reader who saved the light theme no longer sees the
  dark one flash first.
- **Loading is announced.** Twelve pages showed nothing to a screen reader while loading; they
  now announce a status.
- **The pull request screen leads with the decision.** Review, checks and merge are three cards
  with a verdict rail, and the actions sit beside them instead of at the foot of the panel.

## Where the work is

| Area                | Files                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Layout contract     | `apps/web/src/components/kit.tsx` (`PageBody`, `ScrollRegion`, `Panel scrollLabel`)  |
| Motion vocabulary   | `packages/ui/src/tokens/motion.css`, `motion.ts`, `motion.test.ts`                   |
| Motion components   | `packages/ui/src/components/CountUp`, `packages/ui/src/lib/use-sliding-indicator.ts` |
| Controls            | `packages/ui/src/components/Checkbox`, `MenuButton`, `Select`                        |
| Shell               | `apps/web/src/components/NavBar.tsx`, `apps/web/src/routes/__root.tsx`               |
| First-paint theme   | `apps/web/index.html`, `apps/web/src/theme-boot.test.ts`                             |
| Pull request screen | `GithubPulls.tsx`, `GithubPullDetail.tsx`, `MasterDetail.tsx`                        |
| Design rules        | `site/guide/design-language.md` (Motion, No page scrolls, first paint)               |

## How to check it

Everything below ran green on 2026-11-02 unless a line says otherwise.

```bash
pnpm lint && pnpm typecheck
pnpm test                       # every package, with coverage
pnpm test:integration           # the gate meta-tests
pnpm test:render                # the rendering budget, against the built bundle
```

Two browser gates need a PostgreSQL URL that `scripts/lib/e2e-database-guard.mjs` accepts (a
loopback host, or a database named test, e2e or ci). Set the ports so the suite cannot reach a
development server on 3000 or 5173:

```powershell
$env:DATABASE_URL = '<loopback postgres url>'
$env:E2E_API_PORT = '3111'
$env:E2E_WEB_PORT = '5273'
pnpm exec playwright test --project=layout-fit      # layout contract, see below
pnpm exec playwright test --project=accessibility   # axe, both themes, four states: 212 tests
```

`layout-fit` is three suites over the same 35 routes. **Desktop** (1280, 1440 and 1920 wide): no
page scrolls. **Reflow** (390 and 820 wide): the page may scroll down but never across, and the
document is not a second scroll container. **Right-to-left** (1280 and 390 wide): nothing starts
to scroll once the page is mirrored. A failure names the element that overflows.

`UI_AUDIT_SHOTS=1` makes `layout-fit` also write a screenshot of every route to
`test-results/evidence/ui-audit/`. Playwright empties `test-results/` at the start of every run,
so copy the images out before running anything else.

Two things in a developer checkout break a first run and are not product defects:

1. A `REPORTER_SECRET` in the repository `.env` is read by the API, so the suite's reporter
   events are refused with `INVALID_REPORTER_TOKEN`. Start the API with `REPORTER_SECRET` set to
   the suite's installation key, or run where no `.env` exists.
2. `/dashboard/prs`, issues and repositories need a connected GitHub installation. The layout
   spec stands in for one with `tests/e2e/support/github-fixture.ts`, which is shaped by the
   shipped contract schemas.

## Decisions a maintainer should know about

- `MenuButton` is on the translucent-overlay list in `apps/web/src/theme-resolution.test.ts`,
  and `design-language.md` says five components, not four. A menu is a popover that opens from a
  row. `AGENTS.md` still says "palette, dialogs, popovers and toasts", which still covers it.
- `eslint.config.js` treats `Checkbox` and `Select` as label controls, because the
  `jsx-a11y` rule only knows DOM element names.
- The accessibility spec's "page rendered" check looked at the first child of `<main>`, which is
  the page guide's zero-height wrapper on a route without tabs, so it called a rendered page
  empty. It now looks for real content, and still fails on a blank page.
- `useFitCount` returns at least one row even when less than one fits, which is how a half row
  can show. The Insights recovery list moved to a scroll region instead; other lists still use it.

## Not finished

Be explicit with the customer about these.

- **No page has been scored against a design rubric.** The measured gates (no scroll, axe, render
  budget) pass; "10 out of 10" is a judgement that was not made page by page.
- **Measured, not looked at:** right-to-left layouts and widths below 1280. The reflow and mirror
  gates prove nothing overflows; nobody has judged whether those layouts look right.
- **Light theme:** Portfolio, Pull requests, Insights, Toolbox and Supply chain were viewed. The
  other pages pass axe contrast in both themes but were not viewed in light.
- **Scroll cue:** a scrolling page body is cut mid-panel, with only a thin scrollbar to say there
  is more. A CSS scroll-shadow was tried and does not show over opaque panels, so it was removed.
  A cue that works needs a script or a panel redesign.
- **Not built:** the shared-element morph from a pull request row to its detail, and a check of
  `j`/`k` row walking in the redesigned rows.
- **Pages reviewed and fixed:** Pull requests, Issues, Insights, Supply chain, Deployment,
  Portfolio, Delivery, Overview. **Seen but not changed:** Cockpit, Runs, Toolbox, Map, Reports.
  **Not looked at:** Access, Members, Audit, AI code, Agents, Health score, Runner and the rest.
- `pnpm coverage:ratchet` fails on `packages/connectors/github` (99.57% statements against a
  recorded floor of 100, line 779). That package was not changed by this work.
- The rendering budget ran on a development machine, not the reference install the ceilings were
  recorded on, so a pass here is evidence and not a release signal.
- `pnpm verify` was not run as one command; its parts were run separately.
