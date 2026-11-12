# Capability justification

`schema/dashboard.ts` defines **18** tables. **16** have a production reader or writer.
The other **2** are justified below: `test_failure_correlations` has a reader and no
writer, and `saml_config` has no access outside tests. It defined 33 until
`0030_drop_superseded_tables` (ledger MNT-60) dropped the three that were superseded,
and 32 until `0066_drop_dormant_tables` (ledger C-6, plan task 15) dropped the fourteen
that nothing read or wrote; see _Dropped_ below.

This file is the alternative to building each table. Ledger row **C-6** requires
either a reader, a writer, a route, a UI and a test **or a written justification
here**, and this is the written justification for the 2.

**Why a file rather than a row per table.** A row is a defect awaiting a fix. These
are columns awaiting a decision, and a decision nobody wrote down is the state this
programme spent C-6 discovering. One file naming each table and its reason means the
next reader has to delete the line as well as the table.

## Read and written (16) — not candidates

| Table                    | Access                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `runs`                   | read and written; the spine of the product                                                                                   |
| `tests`                  | read and written by the reporter pipeline                                                                                    |
| `canonical_run_results`  | read by run detail                                                                                                           |
| `quarantine`             | read and written; a named product surface                                                                                    |
| `runners`                | read and written                                                                                                             |
| `schedules`              | one reader, two writers — in `apps/worker/src/postgres-store.ts` as **raw SQL**, not through Drizzle                         |
| `audit_events`           | **four writers, zero readers**                                                                                               |
| `quality_gate_config`    | read and written                                                                                                             |
| `projects`               | read and written by the project registry                                                                                     |
| `scan_snapshots`         | written on scan, read by `apps/api/src/services/scan-history-service.ts` and the cockpit                                     |
| `workspaces`             | written by `ensureWorkspace`, read by `apps/api/src/routes/workspaces.ts`; every `workspace_id` has a `restrict` key onto it |
| `trends`                 | written by the daily rollup (`apps/api/src/services/trend-rollup-store.ts`, `0064`)                                          |
| `failure_clusters`       | written by the cluster job (`apps/api/src/services/failure-cluster-store.ts`, `0063`)                                        |
| `fingerprint_categories` | read and written by triage labels (`apps/api/src/services/triage-label-service.ts`)                                          |
| `defect_categories`      | the categories `0048` seeded; every triage label write names one through `fingerprint_categories.category_id`'s key          |
| `users`                  | read and written by members and SCIM (`apps/api/src/routes/members.ts`, `apps/api/src/routes/scim.ts`)                       |

Two corrections that a grep would have got wrong, and both are why this file exists
rather than a tally:

- **`schedules` is not dormant.** A sweep searching `.from(`/`.insert(` misses raw SQL.
- **`audit_events` is not dormant either.** It is write-only. A justification saying
  "no reader" is true; one saying "no writer" is false, and
  `modules/dashboard/audit-sink.ts` already records the _no-writer_ state as a fixed
  defect. It is not a C-6 candidate.

## Not read and written (2)

Neither is a security or correctness problem: nothing writes them in production, so
nothing can read a wrong value out of them.

| Table                       | Access                                                                | Why it is still here                                                                                           |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `test_failure_correlations` | read by `apps/api/src/services/change-risk-service.ts`; no writer yet | change risk reads it, so dropping it would remove a live query; the correlation job that fills it is not built |
| `saml_config`               | read only by tests                                                    | the test exercises the sealed-key contract; SAML sign-in is not built                                          |

## Dropped

`0030_drop_superseded_tables.sql` (ledger MNT-60) removed the three tables this file
called superseded, after a search of `apps/`, `packages/`, `tools/`, `tests/` and
`scripts/` found no reader or writer outside schema-shape assertions, the migration
graph and the legacy importer's own mappings:

| Table         | Replaced by             | What else named it                                                                    |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `results`     | `canonical_run_results` | FKs from `attachments.result_id` and `artifacts.result_id`; the `migrate-cli` mapping |
| `blob_shards` | `runs.read_at`          | the `migrate-cli` mapping                                                             |
| `api_keys`    | the installation key    | the `migrate-cli` mapping; two constraints that 0006 and 0009 added and a test pinned |

The migration refuses to drop a table that holds rows unless
`lupin.allow_drop_nonempty` is `on`. The two foreign keys are dropped and the
columns kept, so `attachments.result_id` and `artifacts.result_id` are now unkeyed
legacy pointers. `migrate-cli` no longer imports the three tables and reports a
populated one as skipped.

`0066_drop_dormant_tables.sql` (ledger C-6, plan task 15) removed the fourteen tables
this file called dormant, after the same search found nothing outside
`packages/db/src/schema/dashboard.ts`, schema-shape tests and the legacy importer:

| Table                        | What it was for                | What else named it                                      |
| ---------------------------- | ------------------------------ | ------------------------------------------------------- |
| `suites`                     | suite catalogue                | the FK from `tests.suite_id`; the `migrate-cli` mapping |
| `attachments`                | reporter evidence blobs        | the `migrate-cli` mapping                               |
| `known_failures`             | flaky-test memory              | the `migrate-cli` mapping                               |
| `nl_query_history`           | natural-language query history | the `migrate-cli` mapping                               |
| `failure_taxonomy_rules`     | classification rules           | the FK from `failure_classifications`; `migrate-cli`    |
| `failure_classifications`    | per-test classifications       | the `migrate-cli` mapping                               |
| `locator_suggestions`        | repair suggestions             | the `migrate-cli` mapping; the `updated_at` 0026 added  |
| `roles`                      | authorisation                  | the `migrate-cli` mapping                               |
| `agent_sessions`             | agent chat                     | FKs from the three session tables below; `migrate-cli`  |
| `agent_session_runs`         | agent chat                     | the `migrate-cli` mapping                               |
| `agent_session_files`        | agent chat                     | the `migrate-cli` mapping                               |
| `generated_test_suggestions` | agent proposals                | the `migrate-cli` mapping; the default 0006 fixed       |
| `repair_attempts`            | self-healing                   | the `migrate-cli` mapping                               |
| `agent_conflicts`            | merge conflicts                | the `migrate-cli` mapping                               |

The migration follows 0030: it refuses to drop a table that holds rows unless
`lupin.allow_drop_nonempty` is `on`, drops `tests_suite_id_suites_id_fk` and keeps
`tests.suite_id` as an unkeyed legacy pointer, and drops the tables children before
parents without `CASCADE`. `migrate-cli` no longer imports the fourteen tables and
reports a populated one as skipped (`SUPERSEDED_SOURCE_TABLES` in
`tools/migrate-cli/src/plan.ts`). `tests/integration/src/drop-dormant-tables.test.ts`
proves the refusal and the opt-in.

## What this does not claim

This file does not claim the tables are correct, current, or a good design. It claims
the two left are **inert or read-only**, and that the cost of leaving them is migration
surface and reader confusion rather than a wrong number on a screen. The tables are
covered by schema-shape assertions, so a change to one that breaks the contract fails a
test.

## Removal condition

Each table is deleted, or gains a production writer, in a migration that records the
decision here. When the last row above is gone this file is empty and is deleted with
it. The condition names what could happen: a writer being written.
