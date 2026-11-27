# Lupin 7: a 10/10 app that keeps watch

Written on 2026-11-26 from a baseline of the tree at `3726c48b`. Paths in backticks exist
today; paths in plain text are created by the task that names them, so
`scripts/lib/docs-paths.test.mjs` keeps checking only real files.

## Problem

The gates are strict, but no single place said how good each area is, and the gaps that remain
are spread across infrastructure, integrations, backend and frontend. The product reports what
is, but does not yet say plainly whether quality got better or worse, why, and whether
AI-written change caused it. It reads only some QA tools' reports, and the runner and the
analyzer have known gaps.

## The owner's requirements

- A checkable 10/10 rubric for infra, integrations, backend, frontend, UX and setup, plus
  raising the existing ratchets.
- Solo first: one person, one install, one API process (ADR-006).
- Incremental waves, `pnpm verify` green after every task.
- 10/10 UI, UX, usability and functionality; easy to set up and to understand; an app that
  keeps watch like a living thing and tells a QA person whether repository quality and health
  went good or bad in the AI era; more QA tools; a better runner and report analyzer.
- "Do what is right and best for the app": the decisions below were made on that basis and can
  be overturned before their wave starts.

## Decisions

1. A criterion only a run on the reference install can satisfy (PostgreSQL 18, Node 26) gets its
   harness built, and closes its ledger row only on a recorded run. Until then the scorecard marks
   it `blockedExternal`, citing the open row, and leaves it out of the denominator.
2. Capability register: every `mock` row becomes real or is removed. `deferred` rows are recorded
   decisions and are not scored. `tool.zap`, `quality.load` and `quality.security` become real
   through the runner work.
3. Mutation testing for the apps (MNT-90): a time-boxed spike on Stryker's command runner. If it
   cannot be made to run mutants, MNT-90 stays debt and the criterion stays blocked on it.
4. "Living" means continuous watching, a direction (Better, Worse, Steady, Unknown) with one
   stated reason, and noticing its own faults. It does not mean more animation: the calm-motion
   rules in `AGENTS.md` hold.
5. New report formats: .NET TRX, NUnit 3, xUnit.net, Cucumber JSON, Robot Framework, Go
   test2json, Newman and Lighthouse.
6. Out of scope, as before: HA and Kubernetes, multi-user features, Jira both ways, MCP write
   tools, a translated interface.

## Rules every task keeps

Those of `.kilo/plans/1794414152760-close-the-gaps-plan.md`, unchanged: tests first and watched
failing; missing evidence is never a pass; every table workspace-scoped with a
`docs/quality/tenancy-scope.json` row and an isolation test; every route guarded with a
`docs/quality/authz-matrix.json` row; every write audited; a regenerated `docs/openapi.json` when
the API changes; a capability-register row, a CHANGELOG line and a guide page per feature; the
design-system rules in `AGENTS.md`; no floor lowered.

## The scorecard

`docs/quality/scorecard.json` holds criteria and never results. `scripts/lib/scorecard.mjs`
derives every verdict from the file that owns the number (coverage, mutation and complexity
baselines, the ledger, the register, the rendering budget, the gate tiers), and refuses a
criterion that carries a result field. `pnpm scorecard` prints the score per area; it is
`pr-reporting` until its first all-pass run, and graduates in one commit that adds `--strict` and
moves the tier.

## Waves

### Wave 1: measure, then fix what is wrong

1. The scorecard (above).
2. Drift and the two coverage values under the standard: the register's k6 drift; the stale
   comment in `.config/vitest.shared.ts`; DEP-3's missing owner and removal condition, with
   `pnpm findings:check` refusing an open row without them; `packages/ui` statements and
   `packages/automation` functions raised to 90 or more.
3. A run's status change and its audit row in one transaction (the D2 leftover in
   `apps/api/src/repositories/drizzle-run-repository.ts`).
4. The twelve GitHub complexity offenders in `docs/quality/complexity-baseline.json`, split
   behind characterization tests, and the ceiling lowered from 12 to 10.

### Wave 2: backend and infra

5. One cursor-page contract (packages/shared-contracts/src/schemas/pagination.ts) and an
   Idempotency-Key middleware (apps/api/src/middleware/idempotency.ts) on create routes.
6. Query budgets (tests/integration/src/query-budget.test.ts) and splitting
   `apps/api/src/execution/drizzle-execution-store.ts` out of its coverage exclusion.
7. Image CVE scanning and keyless cosign signing in `.github/workflows/release.yml`; a
   healthcheck on the production `web` service and a read-only runner in
   `infra/compose/docker-compose.unified.yml`; a nightly backup-and-restore drill.
8. Operator metrics and alert rules with a dashboard (infra/observability/).
9. The toolchain majors and the mutation spike, under decisions 1 and 3.

### Wave 3: more QA tools, a better runner and analyzer

10. Jira and Signal honour 429 and Retry-After; recorded-fixture tests per connector; HTTP-level
    MCP tool tests (apps/api/src/mcp/tools.test.ts); a Jira guide (site/guide/jira.md).
11. The eight new formats through `packages/shared-contracts/src/schemas/report-formats.ts` and
    `packages/reporter/src/adapters/`, one per commit, TRX first.
12. Runner presets on the generic spawn, a ZAP producer modelled on
    `apps/runner/src/k6-execution.ts`, live logs and rerun-on-failure.
13. The failure analyzer (apps/worker/src/failure-analyzer.ts): clusters by cause, regressions
    against the previous run on the same branch, test output kept untrusted.

### Wave 4: the living app

14. The quality pulse (packages/reporting/src/quality-pulse.ts): direction, confidence and one
    cause per project, AI-change signals included; missing evidence is `unknown`.
15. The pulse on Home, a timeline, a notice when the direction turns worse, MCP `get_briefing`,
    and Home in `tests/performance/rendering-budget.json`.
16. Self-checks (packages/reporting/src/self-checks.ts) feeding `apps/web/src/lib/attention.ts`.

### Wave 5: UX, usability, setup

17. Shared error and loading states in `packages/ui`, the largest components split, a glossary
    behind every metric, a bundle budget gate.
18. Timed task scenarios (tests/e2e/usability/tasks.spec.ts), and UI-1 closed.
19. `start doctor` in `infra/release/start.sh` and its two siblings, a framework-aware upload
    snippet in the setup wizard, a demo project, a five-minute guide (site/guide/five-minutes.md).
20. Rescore, and graduate the scorecard to `pr-blocking`.

## Progress

Recorded per task in the commit that completes it; `pnpm scorecard` is the current reading.

Reading on 2026-11-27: infra 10, integrations 10, backend 9, frontend 8, ux 8, setup 10.

- **Done:** tasks 1-19. Tasks 15 (pulse on Home), 17 (shared states, bundle budget) and 18
  (timed usability tasks) closed this session, and the execution store left its coverage
  exclusion, which found and fixed MNT-208.
- **Blocked outside the code:** PostgreSQL 18 (DEP-5), Node 26 (RUNTIME-1), the ZAP scan
  (BK-2), app mutation scores (MNT-205), Home's rendering ceiling (PERF-2). Each needs a run on
  the reference install or a host carrying the tool.
- **Open, and each a large change of its own:**
  - `frontend.complexity`: a ceiling of 10 puts 133 functions in 108 files over it.
  - `backend.no-mock-capability`: nine register rows are still `mock`.
  - `ux.route-states`: UI-1 condition (b), a loading/empty/error/partial test per route.
- **Task 20 not done:** the scorecard stays `pr-reporting` until it is all-pass.