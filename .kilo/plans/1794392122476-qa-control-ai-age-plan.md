# Lupin 5: QA control in the AI age

Decided with the repository owner on 2026-11-11. AI agents write and merge code faster than QA
can review it. Lupin already measures grades, scorecards, diff coverage, AI attribution, flake
cost, DORA and quarantine; it does not yet answer, at every zoom level, whether testing keeps up
with change, whether each SDLC phase was respected, and whether a change, a repository or a
portfolio is in good or bad shape.

Paths written in backticks exist today. Paths written in plain text are new and are created by
the task that names them, so `scripts/lib/docs-paths.test.mjs` keeps checking only real files.

## Decisions

- Order: per-PR oversight of AI change, then pace, SDLC phases and summaries, then zoom levels,
  then breadth (GitHub App, GitLab, test impact, SAML).
- Summaries: deterministic templates always; LLM narration through `packages/automation` is an
  option per workspace. Every narrated sentence cites a briefing item; a sentence with no
  citation, an unknown id, or a number absent from the source discards the narration. The model
  sees metadata only unless an admin opts the workspace into diff hunks. Neither prompt nor
  narration is stored.
- No roles. Zoom levels instead: test, pull request, repository, portfolio.
- GitHub posting: CI-posted by default (works on a LAN install with no server token); the server
  posts when it holds one; a GitHub App is optional.
- Track both pace (is testing keeping up) and the five SDLC phases (plan, code, test, review,
  release), with a Good / Caution / Bad shape at every level.

## Rules every task keeps

- Missing evidence is never a pass, never `low` risk, never `done`, never Good.
- No per-person data; CODEOWNERS user entries are counted, never stored.
- Every table workspace-scoped with a hard boundary, a `docs/quality/tenancy-scope.json` row and
  an isolation test. Every route guarded, with an authz-matrix row.
- Tests written first and watched failing. Property suites registered in
  `docs/quality/property-invariants.json`.
- Automation suggests and never skips: nothing here hides a deterministic failure.
- The risk level is a sum of stated factor points, each with its evidence, so the number can be
  checked by hand. `packages/reporting/src/cockpit-risk.ts` declines an invented score; this
  one is a published, versioned table, which is the difference.

## Definition of done for the small details

Every number has its window, unit and source and links to its evidence; unknown reads "not
measured", never 0. Every verdict shows its data age, and stale data turns it to Caution.
Truncation is stated in the API (`truncated: true`), the comment and the screen. Empty, loading,
error and not-configured states name the next step. Posting is idempotent (one sticky comment,
one check run per head) and a GitHub refusal never changes the CI verdict. Digests are quiet when
nothing moved, respect a timezone and quiet hours, and stay within `PLATFORM_LIMITS`. Lists walk
with `j`/`k`; status marks carry screen-reader labels; the rendering budget holds. Every write is
audited. Each feature ends with a guide page, a CHANGELOG line, a regenerated OpenAPI document
when the API changed, and a `real` capability-register row.

## Wave 1: control of change

0. Commit this plan.
1. Change-risk model, pure: packages/reporting/src/change-risk.ts with a property suite
   (RISK-1 more evidence never lowers the level, RISK-2 missing evidence is never `low`,
   RISK-3 the score is the sum of the factor points).
2. Blast radius, pure: packages/reporting/src/blast-radius.ts. Sensitive-area catalogue,
   CODEOWNERS teams, failure-correlated tests, stated truncation.
3. `lupin diff-guard`: tools/lupin-cli/src/diff-guard.ts reads the local git diff and reports
   test tampering (deleted tests, added skips and focus, removed or loosened assertions, empty
   catches, bulk snapshot updates, lowered thresholds, CI steps made non-failing, added
   retries) as counts, paths and lines. No source text leaves CI.
4. Persisted assessments: a `pull_request_risk_assessments` table and a change-risk service.
5. Risk in the gate and in the sticky comment, with `riskPolicy.blockAt` defaulting to report-only.
6. Check runs posted with the server's token, falling back to a commit status on 403.
7. Verdicts posted from CI: `lupin gate --post` with the job's own `GITHUB_TOKEN`.
8. PR risk on the web: a risk column, a PR detail page, high-risk AI PRs in Home's attention.
9. Close the wave: capability rows, guide, CHANGELOG, e2e, `pnpm verify`.

## Wave 2: pace, phases and summaries

10. Fill the digest inputs `loadReport` leaves empty today (flaky, failing, slow, coverage).
11. Pace scorecard and untested-change debt (PACE-1, PACE-2).
12. SDLC phase model, pure (PHASE-1, PHASE-2).
13. Phase reads and UI: PR strip, repository band, portfolio heatmap.
14. Deterministic briefing with cited items.
15. Optional LLM narration with citation validation.
16. The briefing on Home, its own page, every digest channel and the MCP server.

## Wave 3: zoom levels

17. One scope model in the URL, chosen in the sidebar.
18. Shape verdict and freshness at every level, and the zoom bar.
19. Subscriptions pick scope, timezone and quiet hours.

## Wave 4: breadth

20. GitHub App, optional. 21. GitLab. 22. Test impact suggestions. 23. SAML 2.0.
24. Close the programme: comparison page, CHANGELOG, `pnpm verify`.

## Deferred on purpose

Full test-case management (a separate product), Bitbucket (after GitLab proves the provider
abstraction), ML clustering (explainable signature clusters are the point).

## Progress

Recorded here as tasks land, so the next session starts from the tree rather than from memory.

- **Wave 1, tasks 0–9: landed** on `feat/qa-control-ai-age`. Change risk (RISK-1..3), blast
  radius, `lupin diff-guard`, persisted assessments (`0058_change_risk.sql`), risk in the gate
  and the comment, the `lupin/change-risk` check run, `lupin gate --post`, and the web (risk
  column and filter, the pull request's risk page, Home). Capability rows
  `change-risk.assessment`, `change-risk.tamper-guard`, `change-risk.github-check`,
  `change-risk.ci-post`; guide `site/guide/change-risk.md`.
- **Left from Wave 1:** the end-to-end spec (needs PostgreSQL and Playwright, not run here);
  `diff-guard` and `--post` inputs on the composite action (it shells out with curl and jq, and
  a second implementation of the CLI in bash would be a second authority); a run of
  `pnpm test:render` on the reference host for the new page.
