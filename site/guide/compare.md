# How Lupin compares

This page says what Lupin does today and where it does not. The Lupin column is checked
against the [capability register](/pages/capabilities); each row there names the test that exercises it.

**The competitor columns are not checked.** They describe the category each product is known for,
written from general knowledge of those products. They change, and a vendor page beats this one.
Where a cell says "yes" about another product, read it as "that product is built around this"
and verify before you decide on it.

## The short version

Lupin is MIT-licensed and runs on one machine you control. Its edge is **control over code that
AI writes faster than anyone can read**: every pull request gets a change risk you can add up by
hand, CI catches tests weakened to pass, missing evidence never reads as safe, and a cited
briefing says what happened while you were away. Underneath is **test intelligence you can read
and self-host**: flaky-test handling that acts on evidence, a quarantine enforced in CI, and
per-test history. It is **not** a test-case management tool, and it does not have the long tail
of integrations or the polish of products that have had a team on them for a decade.

## By category

| Need                                                  | Lupin                                                                                                                                                                                                                                                                                                                               | Where the others lead                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Flaky tests** (Trunk, BuildPulse, Datadog)          | Evidence-based: a retry pass or a same-commit disagreement is required before anything is automatic; a cross-commit flip only ever produces a suggestion.                                                                                                                                                                           | Hosted products run it across many repositories and have years of tuning on real flake patterns.                     |
| **Quarantine in CI**                                  | `lupin test` exits 0 only when the server says every failure is an approved quarantined test. The run and test rows stay `failed`; the excuse is recorded.                                                                                                                                                                          | Some products wrap more test runners natively. Lupin reads JUnit and Playwright JSON.                                |
| **Triage** (ReportPortal, Allure TestOps)             | Failure causes are clustered by message; you label them `product`, `test`, `environment` or `known-issue`, and the label follows every recurrence.                                                                                                                                                                                  | ReportPortal has ML-assisted auto-analysis. Lupin has none, on purpose: clustering is by message.                    |
| **CI orchestration** (Currents)                       | `lupin shard` balances files by median duration so shards finish together, and prints every file when the plan is unavailable.                                                                                                                                                                                                      | Currents orchestrates at the worker level at run time. Lupin plans before the run starts.                            |
| **Live results**                                      | `@lupin/playwright-reporter` streams a run and uploads failure traces, screenshots and videos. Needs database mode for artifacts.                                                                                                                                                                                                   | Hosted dashboards ship an embedded trace viewer. Lupin gives you the file to open locally.                           |
| **Migrating off Allure**                              | `format=allure-results` imports Allure 2 result files. Identity follows Allure's own `historyId` inputs.                                                                                                                                                                                                                            | TestOps history, test cases and launches are not imported.                                                           |
| **AI-written change** (CodeRabbit, Graphite, LinearB) | [Change risk](/guide/change-risk) as a sum of stated factor points, on the pull request, a `lupin/change-risk` check run and its own page; required evidence missing makes a change `unknown`, never low. `lupin diff-guard` reports tests weakened to pass, sending no line of source.                                             | Review bots read and comment on the code itself with a model. Lupin does not read the diff with a model, on purpose. |
| **Where work is stuck, and whether testing keeps up** | [SDLC phases](/guide/phases-and-pace) per change, the bottleneck per repository, pace and the untested-change debt, and a good-or-bad verdict with its freshness at every level.                                                                                                                                                    | Engineering-analytics products cover more sources (issue trackers, calendars) and have benchmarks across companies.  |
| **Summaries for leads**                               | A [briefing](/guide/briefing) where every line cites its source, on Home, in every scheduled report and over MCP; a model may reword it and is thrown out if it adds a number.                                                                                                                                                      | Hosted products write longer narratives with a model, without the per-line check.                                    |
| **Test-case management** (Testmo, Allure TestOps)     | **Not built.**                                                                                                                                                                                                                                                                                                                      | This is the main reason to choose them. If you manage manual cases and plans, Lupin is not for you.                  |
| **Test-impact analysis**                              | `lupin impact` lists the tests a change needs first, by name (changed tests, and tests named after changed sources), and the changes no test covers. Runs in the job; sends nothing.                                                                                                                                                | Datadog and others select by coverage traces, which finds tests a naming rule cannot.                                |
| **GitHub and GitLab**                                 | Statuses, comments and check runs on GitHub, as a [GitHub App](/guide/change-risk#on-the-pull-request) or with a token; from GitLab CI, a status and a merge-request note. Delivery sync is GitHub only.                                                                                                                            | Hosted products install as apps on both and sync both.                                                               |
| **SSO / SAML**                                        | OIDC sign-in with a role per person per workspace (`team`); SAML through Cloudflare Access, so the app parses no XML signatures, plus SCIM provisioning and enforced single sign-on with break-glass (`enterprise`). Proven against in-process providers only: no run against a real Entra, Okta or Cloudflare account is recorded. | Hosted products ship many identity-provider integrations, tested against each, with a support line behind them.      |
| **Remote access**                                     | Cloudflare Tunnel plus Access (`--remote cloudflare`): no router port opened, and the app verifies the token Access signs. Or LAN mode on one network.                                                                                                                                                                              | Hosted products are reachable from anywhere by default.                                                              |
| **Several teams on one install**                      | Several workspaces per install (`team`), each with its own projects, runs, tokens, members and audit trail; runners are one shared pool.                                                                                                                                                                                            | Hosted products have organisations, billing and per-seat administration. Lupin has neither billing nor seats.        |
| **Audit**                                             | A hash-chained, append-only audit trail the database enforces, readable, checkable and exportable by an admin, plus `pnpm audit:verify`.                                                                                                                                                                                            | Hosted products hold audit logs for you, often with retention tiers and SIEM connectors.                             |
| **Licence and hosting**                               | MIT. One server, PostgreSQL, no telemetry to a vendor. You operate it. One install serves one person or a whole organisation through [profiles](/guide/profiles).                                                                                                                                                                   | Hosted products are operated for you, with support and SLAs. Some are open core.                                     |

## What has and has not been verified

- **Verified by tests in this repository:** the quarantine and flake rules (property-tested), the
  shard planner (property-tested), change risk, the briefing, the phases, pace and shape
  (property-tested), the reporter against real Playwright 1.64, the artifact route in database
  mode on PGlite, and cross-workspace isolation for every new route.
- **Verified end to end against a real HTTP server:** `lupin test`, with exits 0, 1 and 1 as designed.
- **Not verified:** delivery to real GitHub or GitLab (only stubbed APIs ran, including the GitHub
  App's token exchange), a model rewording the briefing (stub providers only), publishing the
  packages to npm (it needs the owner's npm token, and whether the `@lupin` scope is free was not
  checked), a Docker plus PostgreSQL end-to-end run, and sign-in through a real Cloudflare account
  or identity provider (OIDC, SAML and SCIM ran against in-process stand-ins written to the
  specifications).
- **Not benchmarked:** there is no head-to-head performance comparison on this page, and none is claimed.

## Choosing

Pick Lupin if you want to own your test data, see which AI-written change to read first and
why, catch tests weakened to pass, read the code that decides what is flaky, and enforce
quarantine in CI without a vendor, whether you are one developer or several teams with an
identity provider. Pick a hosted product if you need case management, a model that reviews the
code itself, an embedded trace viewer, identity integrations someone else has tested against
your provider, or a vendor to call.
