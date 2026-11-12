# Lupin 6: close the gaps

Written on 2026-11-11, from a gap analysis of the tree at `ef8cc2b3` (Lupin 5, all four waves
verified). Lupin 5 made AI-written change visible. This plan makes what is visible actionable,
then widens what the release decision can see.

Paths written in backticks exist today. Paths written in plain text are new and are created by
the task that names them, so `scripts/lib/docs-paths.test.mjs` keeps checking only real files.

## Decisions, and the assumptions behind them

- **Solo first (2026-11-12, the owner's call).** The remaining work targets one person on one
  install. Cut from this plan: per-project roles; anything for a second person or team (sharing,
  assignment, per-person notices); SCIM and multi-workspace routes in the OpenAPI work of task 32;
  workspace-level budgets in task 36 (project budgets stay); and task 34 narrows to exporting this
  install's data for a restore. Multi-user code that already exists (OIDC, members, SCIM,
  workspaces) is kept and kept passing its tests, and is not extended.
- **Jira both ways cut (task 22, same day, the owner's call).** The existing one-way Jira issue
  creation stays; update, transition, comment, search and the inbound webhook are not built.
- **Only what must remain (same day, the owner's call).** Kept and done: task 37 (test output that
  reaches a model is untrusted) and task 36 (a monthly token budget for this install's own model
  calls, without a price table), because each guards a real failure: a prompt injection from a
  test log, and an unbounded bill. Tasks 21 and 24 were already built and are kept. Cut: tasks 23,
  25 to 35 and 38 to 42. Each still reads as a gap above; none is a defect in what exists.

The owner asked for the plan without answering these, so each is stated and can be overturned
before its wave starts.

- Order: defects and drift first (Wave 0), then QA actions (what a person cannot do today),
  then access hardening, then test
  intelligence, then gate breadth, then formats and integrations, then the screens that read
  across projects, then platform.
- A release sign-off is a record, not a gate: it never changes a verdict, it records who
  decided, against which verdict and evidence, and why. "Who" is the role and the actor id the
  audit trail already stores; no new per-person data.
- Access tokens get an expiry, defaulting to 90 days for new tokens. Existing tokens keep no
  expiry until rotated, and the Access page says which ones have none.
- Scopes reuse the permissions `packages/auth/src/permissions.ts` already defines, rather than a
  second vocabulary.
- Failure clustering moves from per request to a stored job, so the dormant tables in
  `docs/quality/capability-justification.md` gain a writer or are dropped, never both kept idle.
- A gate domain other than browser is computed only from uploaded evidence. With no upload it
  stays `not_configured`, never `passed`.
- Not in this plan: high availability and Kubernetes (ADR-006), Bitbucket and Azure DevOps,
  Jenkins, CircleCI and Buildkite, TestRail, Xray and Zephyr, Linear, PagerDuty and Opsgenie
  beyond outbound webhooks, interactive Slack and Teams messages, mobile device farms, native
  OpenAI and Anthropic adapters, MCP write tools, forecasting, and a translated interface.
  Each is a product decision rather than a gap in what exists, and each is named here so its
  absence is a decision a reader can see.
- Wave 0 comes first: defects and drift are fixed before new surface is added on top of them.
- The toolchain upgrades (Node 26, Effect 4, TypeScript 7, PostgreSQL 18) stay with their
  ledger rows and are not repeated here.

## Rules every task keeps

The rules of `.kilo/plans/1794392122476-qa-control-ai-age-plan.md` carry over unchanged:
missing evidence is never a pass; no per-person data; every table workspace-scoped with a
`docs/quality/tenancy-scope.json` row and an isolation test; every route guarded with a
`docs/quality/authz-matrix.json` row; tests written first and watched failing; every write
audited; each feature ends with a guide page, a CHANGELOG line, a regenerated
`docs/openapi.json` when the API changed, and a `real` capability-register row.

## Wave 0: fix what is wrong before adding anything

Found by a second sweep on 2026-11-11, each confirmed by reading the code. Every item first
becomes a row in `docs/quality/findings-ledger.json` with `provenance: "hand"`, then is closed
by a test written against the defect and watched failing. Ordered by harm.

**Correctness and security**

- D1. Done 2026-11-11 (ledger MNT-170). Installation-wide quality gates could be changed from
  any workspace: `list`, `get`, `update` and `remove` in
  `apps/api/src/modules/dashboard/drizzle-stores.ts` filtered by id only, and the routes in
  `apps/api/src/modules/dashboard/quality-gates.ts` checked the plain admin role. Measured
  harm, narrower than first written: the run gate reads quality policies, not these rows, and
  the readiness threshold reads only a workspace's own rows, so no verdict changed; the gates
  and their audit trail were exposed. Now every statement is limited to shared rows and the
  store's own workspace, a shared gate needs an installation admin, each gate carries its
  scope, and the audit row names the caller.
- D1a. Done 2026-11-11 (MNT-203): readiness reads the default gate; the copy is true. Found while fixing D1: Settings → Quality gates says "A run that misses its gate is
  marked failed", but nothing marks a run failed from these rows; the run gate reads quality
  policies. Either make a gate feed the run gate, or say what a gate does today.
- D2. Done 2026-11-11 (ledger MNT-171), and worse than first written: the production
  composition passed no audit sink, so run status changes were never audited, and every
  quarantine decision was recorded as `anonymous`. The run status change trusted a client
  header for the audit actor and could revive a finished run. `apps/api/src/modules/dashboard/runs.ts` recorded `x-actor-id` (or
  `anonymous`) instead of the authenticated caller, its audit sink was optional, and the
  terminal check and the write in `apps/api/src/repositories/drizzle-run-repository.ts` were
  a read then an unconditional update. Now the caller and the sink are required, the write is
  a compare-and-set, and quarantine writes name the caller. Left open: the status write and
  its audit row are not one transaction.
- D3. Done 2026-11-11 (ledger MNT-172). Failures were reported as "not configured". `apps/api/src/services/github-app-service.ts`
  turns every GitHub refusal and network error into "no token" and parses the vault entry
  outside a try; `apps/api/src/index.ts` turns a vault or database fault in `tokenFor` into
  "no token"; `apps/api/src/routes/delivery.ts` discards a failed sync after answering 202;
  `apps/api/src/copilot/routes.ts` hides a CODEOWNERS failure. Each keeps its fallback and
  logs the cause with the request id, and a corrupt vault entry answers as corrupt.
- D4. Done 2026-11-11 (ledger MNT-173). The break-glass sign-in was audited with `void audit(...)` in `apps/api/src/index.ts`,
  and `audit` in `apps/api/src/services/access-service.ts` swallows insert failures. The one
  event documented as always audited can go unrecorded. Await it, and refuse break-glass when
  the audit row cannot be written.
- D5. Done 2026-11-11 (MNT-174). The OIDC discovery cache in `apps/api/src/routes/oidc.ts` is never evicted and keys
  entries by the plaintext client secret, so every tested identity draft stays in memory with
  its secret for the life of the process. Key by a hash, bound the cache, and evict on apply.
  Parse the OIDC flow cookie with a schema instead of a cast.
- D6. Done 2026-11-11 (MNT-175). Process-local state that splits with two API processes: the rate limiters in
  `apps/api/src/middleware/rate-limit.ts`, the admin-change lock in
  `apps/api/src/routes/members.ts`, the GitHub App token cache and the OIDC cache. ADR-006 is
  one process, so the fix is to state it at startup (refuse a second API process against the
  same database, through an advisory lock) rather than to distribute the state.
- D7. Done 2026-11-11 (MNT-176), by reading back what was stored. The legacy orchestration routes answer `GET /api/v1/schedules` with a literal empty list
  while `POST` stores one (`apps/api/src/routes/orchestration.ts`), over the in-memory
  `apps/api/src/services/orchestration-service.ts` and `apps/api/src/services/runner-control.ts`.
  They are 503 in production already; remove them outside production too, or read back what
  was stored, and take their rows out of the authz matrix.
- D8. Done 2026-11-11 (MNT-177). `packages/orchestration/src/schedule.ts` exports a `nextOccurrence` that throws for an
  hour of `'*'` its own type allows, ignores the minute for `'step'`, and is imported only by
  its tests, beside a different `nextOccurrence` in
  `apps/api/src/services/notification-service.ts`. Delete the dead one.
- D9. Done 2026-11-11 (MNT-178); the code already shared one formula, the test and the comment were missing. The flaky leaderboard in `apps/api/src/execution/insights.ts` and flake cost in
  `packages/reporting/src/flake-cost.ts` count flakiness over different denominators and
  nothing asserts they agree. One function, used by both, with a property test.
- D10. Done 2026-11-11 (MNT-179), by dropping the column. The authz matrix's `workspaceScoped` flag marks scoped handlers (runs, quarantine) and
  the unscoped quality gates the same way, so it cannot find a leak. Derive it from the store a
  handler uses, or drop the column and rely on isolation tests, and say which in
  `docs/quality/authz-matrix.json`.

**Stale statements that a reader will quote**

- D11. Done 2026-11-11 (MNT-180). `apps/api/src/index.ts` says twice that there is no authentication middleware and that
  the install is open, beside route guards, SSO enforcement and break-glass in the same file.
  The same wording is in `apps/web/src/lib/api.ts`, `apps/web/src/router.ts` and the
  palette's "no Sign out" comment. Rewrite each to the real posture: open on loopback in solo,
  guarded with LAN mode or a team or enterprise profile.
- D12. Done 2026-11-11 (MNT-181), with the stale Map paths in six guides. `site/guide/sending-results.md` and `README.md` list four upload formats; the API also
  reads Allure (`packages/shared-contracts/src/schemas/report-formats.ts`). The comment in that
  file says SARIF has no ingestible format, though the health door reads SARIF. The register
  row `reporting.lifecycle` says five adapters where there are six. Fix all four.
- D13. Done 2026-11-11 (MNT-181). `site/guide/notifications.md` and `README.md` leave out the email channel, which the
  dispatcher sends.
- D14. Done 2026-11-11 (MNT-181). `site/guide/cli.md` documents `diff-guard` only inside the GitLab example; it belongs in
  the command list with the others.
- D15. Done 2026-11-11 (MNT-183); the coverage table is held by docs-drift and left. `AGENTS.md` names `/setup` as the first run (it is `/dashboard/setup`), a
  .kilo/command directory that does not exist, Vitest 4 (the catalog is on 5), and omits
  `apps/tui`; its coverage table rounds floors up past the recorded baseline and omits about
  twenty packages. Fix the facts, or generate the table from
  `docs/quality/coverage-baseline.json`.
- D16. Done 2026-11-11 (MNT-181). The register row `tool.zap` is `missing` while its own text says the parser exists and
  is wired. Split it into the parser (real) and the producer (missing).
- D17. Done 2026-11-11 (MNT-182). `apps/api/src/execution/maturity.ts` still lists JUnit as the legacy adapter and k6 and
  Bruno as absent. Covered by task 20; recorded here so the drift has a ledger row.
- D18. Half done 2026-11-11: the description is corrected; recording a ceiling for `/dashboard/now` needs `pnpm render:baseline` on the reference install, which this host is not. The rendering budget in `tests/performance/rendering-budget.json` measures `/dashboard`,
  not the landing page `/dashboard/now`, and its comment names an "Overview" that is no longer
  the landing. Add the landing page and record its ceiling.
- D19. Already handled, found on 2026-11-11: each translated home shows a banner in its own language saying the docs are in English (`site/.vitepress/theme/LocalizedHome.vue`). No change. Each of the 22 translated site homes links to English guides with translated button
  labels (`site/.vitepress/config.mts`). Say on each home that the guides are in English.
- D20. Done 2026-11-11 (MNT-183). Stale comments in `apps/web/src/routes/dashboard/settings.tsx` ("wired in Task 5") and
  the header of `apps/web/src/route-manifest.ts` (Delivery as an area).

**Frontend defects**

- D21. Done 2026-11-11 (MNT-184): the old paths redirect (`legacySettingsPath` in
  `__root.tsx`), are hidden in the manifest, and the palette filters by role. Five admin pages exist twice, at `/dashboard/access|members|audit|deployment|reports`
  (`apps/web/src/routes/dashboard/portfolio.tsx`, `apps/web/src/routes/dashboard/reports.tsx`)
  and under `/dashboard/settings/*`. The top-level copies are in the palette with no admin
  floor, so a viewer is offered pages the API refuses, and the sidebar highlights nothing on
  them. Redirect the old paths to the settings ones and filter the palette by role.
- D22. Done 2026-11-11 (MNT-184): every `GO_TO` target is a sidebar address, held by
  `navigation-consistency.test.ts`. `g d` in `apps/web/src/components/Shortcuts.tsx` says Delivery and opens Pull requests;
  `g s` and `g a` open the duplicate paths; `g n` says Now where the sidebar says Home.
- D23. Done 2026-11-11 (MNT-184), in part by design: "Can we ship?" opens Home, labels are the
  sidebar's ("Home", "Tests"), "Toggle theme" is sentence case. Flaky, slow and coverage stay on
  Tests and Health: the flaky and gaps pages need a project id a palette question does not
  have, and Tests holds both leaderboards. Palette questions in `apps/web/src/components/GlobalCommandPalette.tsx` land on general
  pages: "Can we ship?" opens Health instead of Home, flaky and slow open Tests instead of the
  flaky page, coverage opens Health instead of the gaps page. Palette labels use the manifest
  label ("Dashboard", "Insights", "Launch") rather than what the sidebar shows; "Toggle Theme"
  is title case.
- D24. Done 2026-11-11 (MNT-185) with `ConfirmAction`; typed for revoke, remove member and
  remove app. A role change through its select is not confirmed: it is undone from the same
  control. Destructive actions take effect on one click: revoke token
  (`apps/web/src/components/Access.tsx`), remove or disable a member and change a role
  (`apps/web/src/components/People.tsx`), remove a GitHub App, a project token or a quality
  gate (`apps/web/src/components/SettingsPages.tsx`), remove a channel or a schedule
  (`apps/web/src/components/Notifications.tsx`). Use the confirmation pattern project delete
  already has, typed for revoke, remove member and remove app.
- D25. Done 2026-11-11 (MNT-186) by one root click handler (`useInAppLinks`) rather than a
  per-link sweep, so all ~40 anchors and any new one are covered. Internal links written as plain anchors reload the whole app: the back link and the
  retried-run link in `apps/web/src/routes/dashboard/run-detail.tsx`, and the queued-run link
  in `apps/web/src/routes/dashboard.tsx`. Use the router's link, and sweep the other anchors.
- D26. Done 2026-11-11 (MNT-187): the role read and the sign-in methods read state their
  failure with a retry. The Home first-run check stays silent by design (its fallback is
  staying on Home, which reports its own reads). Silent failures: `apps/web/src/hooks/useViewerRole.ts` turns a failed role read into no
  role, so admin pages vanish from the sidebar with no message; `Access.tsx` hides SSO when the
  sign-in methods fail; the Home onboarding fetch ignores errors. Show a stated failure and
  retry.
- D27. Done 2026-11-11 (MNT-188): backoff to a minute, and no poll in a hidden tab.
  `apps/web/src/hooks/useRuns.ts` polls every 5 seconds while the event stream is down,
  with no backoff on a failing API and no pause in a hidden tab.
- D28. Done 2026-11-11 (MNT-189): all seventeen controls are library ones, held by
  `form-control-rule.test.ts`. Server errors stay one alert per form, because the API names
  no field. Forms built from raw inputs with local class strings (quarantine, the launch form,
  runner, toolbox, delivery, supply chain, copilot) instead of the `Input` from `@lupin/ui`,
  with one alert line rather than a message per field.
- D29. Done 2026-11-11 (MNT-190). Quarantine copy: title case ("Error Loading Quarantine List", "Test Title", "Test
  File"), a "Submit" button, three dots instead of an ellipsis, an empty-state line that
  repeats its title, and `text-error` beside `text-danger`. The run-detail artifact list
  shows raw byte counts and three dots after the checksum.
- D30. Done 2026-11-11 (MNT-191), in part: nine unnamed tables are named (the other 19 had
  an `aria-label`, so "8 of 36 have a caption" overstated it), the artifact list is paged,
  and `run-detail.tsx` is split into `components/run-detail/`. The other ten components over
  600 lines are held by `component-size.test.ts` rather than split here: splitting files
  nobody is changing carries regression risk for no change in behaviour, so each is split
  when next changed. Tables without captions (8 of 36 have one), the unpaged artifact list on run detail,
  and components over 600 lines (`run-detail.tsx` at 1133) split along their panels.
- D31. Done 2026-11-11 (MNT-192): deleted, the row repointed at the screens, and a gate that
  refuses the next one. `apps/web/src/components/dashboard/RunExplorer.tsx` is imported only by its own test,
  and the register row `reporting.explorer` cites it as evidence. Delete it and point the row
  at the screen that is used.

**Build, database and supply chain**

- D32. Done 2026-11-11 (MNT-193): `0059_snapshot.json` generated from the schema module;
  `drizzle-kit generate` reports no changes and `snapshot.test.ts` holds it. Drizzle snapshots stop at `0004` while `packages/db/drizzle/meta/_journal.json` reaches
  `0059`, so `pnpm db:check` checks nothing after 0004 and `pnpm db:generate` would diff
  against a schema 55 migrations old. Regenerate a current snapshot, and add a test that the
  latest snapshot matches the latest journal entry.
- D33. Done 2026-11-11 (MNT-194) by the second option: every query is `PREPARE`d against
  the migrated schema in `tests/integration/src/worker-sql.test.ts`. `apps/worker/src/postgres-store.ts` runs 28 hand-written queries with hand-typed rows,
  so a renamed column typechecks and fails at run time. Move it onto the Drizzle schema, or
  add a test that every column it names exists in the schema.
- D34. Done 2026-11-11 (MNT-195): 8.72.1 stays (it lints within the 6 GB heap 5b8a912e
  gave lint); the stale comment and the contradicting ignore are fixed, and a test refuses
  the next one. `pnpm-workspace.yaml` pins `typescript-eslint` to 8.72.1, the version its own comment
  says runs lint out of memory, while `.github/dependabot.yml` ignores that version; lint runs
  with a 6 GB heap to cope. Pin 8.72.0 or record why 8.72.1 stays.
- D35. Done 2026-11-11 (MNT-196): digests from the registry, Dependabot `docker-compose` for
  `/infra/compose`, and the CI postgres held to the compose pin. Compose images in `infra/compose/docker-compose.unified.yml` (postgres, seaweedfs,
  signal, cloudflared) and the CI service image are pinned by tag only, and Dependabot does not
  watch `/infra/compose`. Pin by digest and add the directory.
- D36. Done 2026-11-11 (MNT-197), images not rebuilt (no Docker engine on this host).
  Compose services other than signal and cloudflared have no restart policy and none has
  a memory or CPU limit, so a reboot leaves the install down and a runaway runner can starve
  PostgreSQL. `infra/docker/web.Dockerfile` and `infra/docker/edge.Dockerfile` have no
  HEALTHCHECK of their own.
- D37. Done 2026-11-11 (MNT-198), with five other shared dependencies. `@electric-sql/pglite` is declared four times with two ranges outside the catalog.
- D38. Done 2026-11-11 (MNT-199); `.kiro/` stays trackable. `semantic-review/`, `.worktrees/` and `.kiro/` are neither tracked nor ignored, and the
  root helper scripts are ignored only through a local exclude. Add them to `.gitignore`.
- D39. Done 2026-11-11 (MNT-200): three clock waits removed; the old web flake did not recur. A `pnpm test` flake in `@lupin/unified-web`, recorded in
  `.kilo/plans/1791152400000-frontend-finish-plan.md`, was never investigated and has no
  ledger row. `apps/api/src/routes/audit.test.ts` sleeps on the real clock.
- D40. Done 2026-11-11 (MNT-201). The nightly quality-baseline upload ignores a missing report, so a run that produced
  nothing is green. Fail when the report is absent.
- D41. Done 2026-11-11 (MNT-202). CI rebuilds the workspace in every job with no shared build cache. Cache the build
  output between jobs.

## Wave 1: QA can act on what it sees

1. Quarantine decisions. Approve, reject and release controls on each row of
   `apps/web/src/routes/dashboard/quarantine.tsx`, calling the decision endpoint that exists,
   with a reason required for reject and release. Add to quarantine from a failing test (run
   detail and Tests) instead of typing a title and file. Done when the decision is audited and
   an operator without the role sees the controls disabled with the reason.
2. Rerun failed tests only. A second action beside "Retry run" in
   `apps/web/src/routes/dashboard/run-detail.tsx`, and an API option that builds the new run
   from the failed and flaky tests of the old one. Playwright and generic-command jobs only;
   other modes say they rerun the whole run. Done when the new run links to the one it reran.
3. Issue from a failure. "Open an issue" on a failure in run detail and Tests, through the
   tracker `apps/api/src/routes/issue-tracking.ts` configures (Jira, or GitHub issues), with
   the failure's message, test, run link and cluster prefilled. The issue key is stored on the
   failure and shown on every later occurrence. Done when a second occurrence shows the
   existing issue instead of offering a new one.
4. Edit a report subscription. An update method in `apps/web/src/lib/notifications-client.ts`
   and an Edit action in `apps/web/src/components/Notifications.tsx` for schedule, timezone,
   project and quiet hours. A pending delivery keeps the settings it was queued with.
5. Release sign-off. A record per project and commit: decision (ship, hold), the verdict and
   evidence ids it was made against, a required reason, and the actor. Shown on Home beside the
   verdict, in the cockpit report, and posted by `lupin gate --post` when present. Overriding a
   failing verdict needs admin and is labelled an override everywhere it appears.

## Wave 2: access that can be narrowed and expires

6. Token expiry and rotation. An expiry column on the table in
   `packages/db/src/schema/health.ts`, enforced at lookup in `apps/api/src/routes/access.ts`;
   a rotate action that issues a successor and revokes the old token after a grace period;
   the Access page lists tokens by expiry. Property suite: an expired token never
   authenticates.
7. Token scopes. A token may carry a subset of its role's permissions; routes check
   permissions through the existing guard so the authz matrix records them. Per-project roles
   are deferred and stated as deferred.
8. API rate limit. A per-token and per-client budget on every route outside the probes, with
   `retry-after`. Today only sign-in, token sign-in, OIDC, pairing and the GitHub webhook are
   limited.
9. Outbound address guard. One function refuses private, loopback, link-local and metadata
   addresses for every admin-configured URL (webhooks, the Ollama base URL, the OIDC issuer,
   email and Signal bridges), with an explicit allowlist setting for a LAN install that needs
   one. Used by `apps/api/src/services/health-integrations.ts` and every connector call.
10. Vault strength. Raise PBKDF2 iterations in `apps/api/src/services/vault-secrets.ts` to the
    current OWASP figure with a versioned key header, so existing entries still open and are
    re-sealed on next write; rotation re-seals every workspace (closes ledger row W7-23).

## Wave 3: test intelligence that is stored

11. Failure clusters as a job. The worker computes clusters from
    `packages/reporting/src/failure-clusters.ts` after each run and stores them in the dormant
    cluster and correlation tables. The Tests page reads stored clusters with first seen, last
    seen, occurrences and linked issue.
12. Known failures. A cluster marked known (with an issue or a reason) is labelled on every new
    occurrence, and stays counted as a failure: known is a label, never a pass.
13. Trend rollups. A daily rollup job writes the dormant trends table; trend charts read it,
    so a 90-day window costs the same as 7 days. Custom date ranges become possible.
14. Retention. Per-workspace retention for runs, test results and artifacts, honouring the
    existing `legal_hold` and `quarantine` artifact classes. A sweep that deletes nothing held,
    reports what it removed, and is audited.
15. Dormant tables decided. Every table left idle after tasks 11 to 13 is dropped in a
    migration that records the decision in `docs/quality/capability-justification.md`
    (closes ledger row C-6 or shrinks it to what remains).

## Wave 4: the release decision sees more than the browser

16. Evidence-backed gate domains. `apps/api/src/execution/quality-gate.ts` computes security
    from SARIF and ZAP uploads, accessibility from axe uploads and performance from k6
    thresholds for the same commit, each with a policy threshold; no upload stays
    `not_configured`. Property suite: no evidence never yields `passed`.
17. ZAP runs. A built ZAP runner image and a security adapter through the agent boundary in
    `apps/api/src/routes/agents.ts`, baseline scan only, against an allowlisted target
    (closes the security half of ledger row BK-2).
18. axe runs. Playwright jobs may opt into an axe pass per visited page, uploaded as the axe
    report the health door already reads.
19. Runner images and isolation. The runner Dockerfiles stop being stubs; jobs run as a
    non-root user with no network beyond the allowlisted target. Register rows `runner.oci`
    and `tool.playwright` move to `real` only on a recorded run.
20. Maturity table truth. `apps/api/src/execution/maturity.ts` is derived from the adapters
    that exist rather than written by hand, so k6 and Bruno stop reading as absent.

## Wave 5: more formats, more places results go

21. Result formats. Native adapters beside `packages/reporter/src/producer-status.ts` for CTRF,
    Jest and Vitest JSON, pytest-json-report and Cypress (Mochawesome), keeping retries,
    steps and attachments that JUnit loses. `lupin test` in `tools/lupin-cli/src/cli.ts`
    accepts them.
22. Jira both ways. Update, transition, comment and search in
    `packages/connectors/jira/src/index.ts`; an inbound webhook so a closed issue shows on its
    failure cluster.
23. Outbound webhooks. Workspace subscriptions to a published event catalogue (run completed,
    gate verdict, sign-off, quarantine decision, health report), signed like the health alert,
    with a delivery log and retries.
24. MCP read tools. Runs, test history and flakiness, quarantine, failure clusters, change risk
    and sign-offs in `apps/api/src/mcp/tools.ts`, read-only and pinned like the existing ten.

## Wave 6: screens that read across projects

25. Lists that sort, filter and remember. Column sorting, filters and search on runs, tests,
    quarantine and portfolio, with the state in the URL so a link reproduces the view.
26. Command palette searches things. Runs, tests, repositories and pull requests in
    `apps/web/src/components/GlobalCommandPalette.tsx`, and the actions a page offers.
27. Export. CSV of any list, and the portfolio in the cockpit report format.
28. Portfolio trends. A multi-project trend chart and a this-period versus last-period
    comparison, both from the rollups of task 13.
29. State matrix. Loading, empty, error, partial and not-configured states with a test per
    route (closes condition (b) of ledger row UI-1), and the Agents page reads the agents API.
30. In-app notices. A notices menu with an unread count for gate verdicts, sign-offs and
    quarantine decisions on the projects in scope.
31. Demo data. A first-run option that loads a labelled sample workspace and removes it in one
    step, so a new install can be explored before CI is wired.

## Wave 7: platform

32. A real API contract. `docs/openapi.json` carries request and response schemas from the
    shared Zod contracts, security schemes and the SCIM routes, and the docs site renders it.
33. Metrics that help an operator. Request latency histograms, queue and lease depth, database
    pool, delivery outcomes and model token counts in `apps/api/src/observability/metrics.ts`,
    with a sample dashboard and alert rules in the operations guide.
34. Workspace export. One command and one admin route that export a workspace's runs, tests,
    health and audit as files a restore or another install can read.
35. Live updates for more than runs. Gate verdicts, sign-offs, quarantine decisions and health
    reports on the event stream.
36. Model spend that is enforced. Workspace and project budgets stop gateway calls when spent,
    with a stated refusal, instead of only being reported; a default price table ships for the
    common models.
37. Test output treated as untrusted. Failure messages and logs that reach a model are fenced
    and labelled as data, and narration that follows an instruction found in them is
    discarded.
38. Backups that leave the host. A configured off-host target for `backup`, and a documented
    path to point-in-time recovery with PostgreSQL WAL archiving.
39. Gates that graduate. `skill-scan`, the nightly smoke job and mutation lose
    `continue-on-error` after a recorded run each (ledger rows MNT-30 and MNT-90), and k6 moves
    from nightly to the release gate.
40. Complexity to 10. The 51 functions at 11 or 12 are split, and the ceiling in
    `docs/quality/complexity-baseline.json` drops to 10 (ledger row Q-1).
41. Documentation that teaches. A tutorial per CI provider and per framework, a troubleshooting
    page, and a migration page from ReportPortal and TestRail.
42. Runner sharding. One run split across runners by the shard planner, with one verdict.

## How each wave is closed

`pnpm verify:local` green in a clean worktree on the wave's last commit, the CHANGELOG and this
plan's progress section updated, and every capability-register row the wave touched backed by a
command that runs. A wave that could not be verified against a real external service says so in
its progress entry rather than claiming it.

## Progress

- 2026-11-11: plan written and committed.
- 2026-11-11: second sweep added Wave 0 (D1 to D41) and tasks 36 to 42.
- 2026-11-12: Wave 0 done; `verify:local` green at `312ad494`.
- 2026-11-12: Waves 1 and 2 done; `verify:local` green at `11739661`. Not done or not verified:
  no e2e run and no real Jira, GitHub, Signal or email bridge; a queued delivery uses edited
  report settings (task 4); sign-off is not in the cockpit report or `lupin gate --post`
  (task 5); flaky tests are not rerun (task 2); the outbound guard does not check URLs set in
  the environment, and DNS rebinding between check and request is open (task 9); W7-23, rotation
  re-sealing every workspace, is still open (task 10). The complexity gate had been dying at its
  6 GB heap since task 3 and measuring nothing; it now has 8 GB.
- 2026-11-12: Wave 3 done; `verify:local` green at `3298aa33`. Not done: retention has an API and
  no screen; custom trend ranges have an API and no picker; `test_failure_correlations` keeps a
  reader and no writer, so C-6 stays debt with two tables; there is no `quarantine` artifact
  class to honour, only `legal_hold`.
- 2026-11-12: Wave 4 done; `verify:local` green at `f083be27`. Not verified: no image was built
  (Docker was not running), no real ZAP scan or axe report, so `runner.oci` and `tool.playwright`
  stay `mock` and BK-2's security half has an adapter and no recorded run. Security findings are
  read from the report the commit uploaded last, through `health_findings.last_report_id`, so a
  later report on another commit can move a finding off it. Job containers do not yet join a
  network limited to the target; the boundary is still `RUNNER_ALLOWED_TARGET_URLS`.
