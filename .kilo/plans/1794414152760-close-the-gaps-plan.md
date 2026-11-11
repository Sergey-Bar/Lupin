# Lupin 6: close the gaps

Written on 2026-11-11, from a gap analysis of the tree at `ef8cc2b3` (Lupin 5, all four waves
verified). Lupin 5 made AI-written change visible. This plan makes what is visible actionable,
then widens what the release decision can see.

Paths written in backticks exist today. Paths written in plain text are new and are created by
the task that names them, so `scripts/lib/docs-paths.test.mjs` keeps checking only real files.

## Decisions, and the assumptions behind them

The owner asked for the plan without answering these, so each is stated and can be overturned
before its wave starts.

- Order: QA actions first (what a person cannot do today), then access hardening, then test
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
  TestRail, Xray and Zephyr, mobile device farms, native OpenAI and Anthropic adapters, and a
  translated interface. Each is a product decision rather than a gap in what exists.

## Rules every task keeps

The rules of `.kilo/plans/1794392122476-qa-control-ai-age-plan.md` carry over unchanged:
missing evidence is never a pass; no per-person data; every table workspace-scoped with a
`docs/quality/tenancy-scope.json` row and an isolation test; every route guarded with a
`docs/quality/authz-matrix.json` row; tests written first and watched failing; every write
audited; each feature ends with a guide page, a CHANGELOG line, a regenerated
`docs/openapi.json` when the API changed, and a `real` capability-register row.

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
   `retry-after`, distinct from the sign-in limiter.
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

## How each wave is closed

`pnpm verify:local` green in a clean worktree on the wave's last commit, the CHANGELOG and this
plan's progress section updated, and every capability-register row the wave touched backed by a
command that runs. A wave that could not be verified against a real external service says so in
its progress entry rather than claiming it.

## Progress

- 2026-11-11: plan written and committed.
