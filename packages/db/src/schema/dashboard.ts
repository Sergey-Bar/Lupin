// Ported from Lupin/apps/server/src/db/schema.ts
// SQLite → PostgreSQL type adaptations:
//   text(UUID) → uuid
//   text(date/ISO) → timestamp with timezone
//   integer(boolean mode) → boolean
//   real → real
//   text(JSON) → jsonb
//   integer autoIncrement PK → serial

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  uuid,
  real,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { GATE_STATUSES } from './vocabularies.js';
import { environments, executionJobs, qualityPolicies, releases } from './execution.js';

export const RUN_PHASES = [
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
  'complete',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
  'partial',
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

export const RUN_OUTCOMES = [
  'passed',
  'failed',
  'unknown',
  'partial',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number] | null;

export type RunSelection =
  | string[]
  | {
      testIds: string[];
      paths: string[];
      tags: string[];
    };

export const RUNNER_HEALTH_VALUES = [
  'healthy',
  'degraded',
  'draining',
  'offline',
  'revoked',
] as const;
export type RunnerHealth = (typeof RUNNER_HEALTH_VALUES)[number];

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  configPath: text('config_path').notNull(),
  testResultsDir: text('test_results_dir'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  /**
   * How many days a run, its test results and its artifacts are kept; `null` keeps them
   * (plan task 14, `0065`). A run with an artifact under legal hold is never removed.
   */
  runRetentionDays: integer('run_retention_days'),
});

export const runners = pgTable(
  'runners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    version: text('version').notNull(),
    protocolVersion: text('protocol_version').notNull().default('1'),
    os: text('os').notNull(),
    arch: text('arch').notNull(),
    capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    slots: integer('slots').notNull().default(1),
    health: text('health', { enum: RUNNER_HEALTH_VALUES }).notNull().default('offline'),
    tokenHash: text('token_hash').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
    tokenRevokedAt: timestamp('token_revoked_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_workspace_name_unique').on(table.workspaceId, table.name),
    uniqueIndex('runners_token_hash_unique').on(table.tokenHash),
    index('runners_workspace_health_idx').on(table.workspaceId, table.health),
    index('runners_heartbeat_idx').on(table.lastHeartbeatAt),
    check('runners_slots_check', sql`${table.slots} > 0`),
    check(
      'runners_health_check',
      sql`${table.health} in ('healthy', 'degraded', 'draining', 'offline', 'revoked')`,
    ),
  ],
);

// ─── projects ────────────────────────────────────────────────────────────────
// Source: projects table — the registry of repositories a run can be executed
// against. Declared here rather than in `schema/execution.ts`, where it lived
// until migration 0023, because `runs.project_id` (below) now carries a foreign
// key to it and `execution.ts` already imports this module: declaring it there
// would have made the two import each other.
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // Where the repository lives on this host, as an absolute path.
    //
    // This is the column that turns the table from a label into a registry. Until
    // 0023 a row carried a name, a slug and a free-text `settings` blob — and
    // `runs.project_id` pointed at it — so a run named an id that resolved to
    // nothing executable and nothing explainable. The detector reads this path;
    // the runner spawns with it as `cwd`; and `score()` never trusts it without
    // re-reading the manifests, because a path is a claim and a manifest is
    // evidence.
    repoPath: text('repo_path'),
    // The last detection proposal, verbatim, as `ProjectProfile`.
    //
    // A **proposal**, never the authority: a checked-in `lupin.config.json`
    // overrides it, and the run records which one ran in `runs.configuration`, so
    // a run can always be explained. JSONB rather than columns because the shape
    // is the detector's, and the detector's shape is versioned beside it.
    profile: jsonb('profile').$type<Record<string, unknown>>().notNull().default({}),
    // Which detector wrote `profile`.
    //
    // `NOT NULL` with a default of 1, and the default is only correct for a row
    // that has never been detected — which is the state `{ profile: {} }` also
    // describes. A profile written by detector 2 can therefore never be read as
    // detector 1's shape, which is the requirement stated as a constraint rather
    // than as a convention somebody has to remember.
    detectorVersion: integer('detector_version').notNull().default(1),
    defaultBranch: text('default_branch'),
    repositoryUrl: text('repository_url'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_workspace_slug_unique').on(table.workspaceId, table.slug),
    index('projects_workspace_idx').on(table.workspaceId),
    // A detector version of zero or below is not a version, and the database is
    // the only place that can refuse it for a row written by a client that did
    // not read this comment.
    check('projects_detector_version_check', sql`${table.detectorVersion} >= 1`),
  ],
);

// Source: scan_snapshots table — added in 0025.
//
// One reading of a project per hour: mean line coverage, the health score, maturity and
// the flaky-test count, so the dashboard can say what changed rather than only what is.
//
// **A history, not a fourth blocking number.** `projects.ts` refuses a stored score for a
// good reason — a cached total that disagrees with the live derivation is two answers to
// one question. This table is never read to *decide* anything: the score, the gate and
// the readiness verdict are all computed live, and a snapshot is only ever drawn as a past
// point on a line. Readings are written on scan, at most one per `(workspace, project,
// hour)`, which the unique index enforces rather than the writer remembering to.
export const scanSnapshots = pgTable(
  'scan_snapshots',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    hour: timestamp('hour', { withTimezone: true }).notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
    coverage: real('coverage'),
    healthScore: real('health_score'),
    maturity: real('maturity').notNull(),
    flakyTests: integer('flaky_tests').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.projectId, table.hour] }),
    index('scan_snapshots_project_taken_idx').on(table.workspaceId, table.projectId, table.takenAt),
    check(
      'scan_snapshots_range_check',
      sql`(${table.coverage} is null or ${table.coverage} between 0 and 100) and (${table.healthScore} is null or ${table.healthScore} between 0 and 100) and ${table.maturity} between 0 and 100 and ${table.flakyTests} >= 0`,
    ),
  ],
);

// ─── runs ──────────────────────────────────────────────────────────────────
// Source: runs table — core run record
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: text('external_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: text('status', {
      enum: ['running', 'passed', 'failed', 'interrupted'],
    })
      .notNull()
      .default('running'),
    phase: text('phase', { enum: RUN_PHASES }).notNull().default('queued'),
    outcome: text('outcome', { enum: RUN_OUTCOMES }),
    attempt: integer('attempt').notNull().default(1),
    priority: integer('priority').notNull().default(0),
    total: integer('total').notNull().default(0),
    passed: integer('passed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    flaky: integer('flaky').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    blocked: integer('blocked').notNull().default(0),
    unknown: integer('unknown').notNull().default(0),
    durationMs: integer('duration_ms'),
    branch: text('branch'),
    commit: text('commit'),
    commitSha: text('commit_sha'),
    commitMessage: text('commit_message'),
    triggeredBy: text('triggered_by').default('manual'),
    config: jsonb('config'),
    configuration: jsonb('configuration').$type<Record<string, unknown>>().notNull().default({}),
    rawArgs: text('raw_args'),
    source: text('source').notNull().default('live'),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>(),
    framework: text('framework'),
    adapterVersion: text('adapter_version'),
    testType: text('test_type'),
    // Added in 0023. The column was a bare uuid for the whole life of migration
    // 0003: any value was accepted, so a run could be attributed to a project that
    // does not exist and nothing recorded that the attribution was invented.
    // `set null` rather than `restrict` — a run is evidence and outlives the
    // registry row, but it must stop claiming a project that is gone.
    projectId: uuid('project_id').references((): AnyPgColumn => projects.id, {
      onDelete: 'set null',
    }),
    // Declared here since 2.3.x: 0003 created these keys and the schema never said so,
    // so a generated migration would have dropped them (ledger MNT-15). The targets live
    // in execution.ts, which imports this file; the references are lazy, so the cycle is
    // never read during module evaluation.
    environmentId: uuid('environment_id').references((): AnyPgColumn => environments.id, {
      onDelete: 'set null',
    }),
    releaseId: uuid('release_id').references((): AnyPgColumn => releases.id, {
      onDelete: 'set null',
    }),
    suite: text('suite'),
    selection: jsonb('selection').$type<RunSelection>().notNull().default([]),
    requiredCapabilities: jsonb('required_capabilities').$type<string[]>().notNull().default([]),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    timeoutMs: integer('timeout_ms'),
    policyId: uuid('policy_id').references((): AnyPgColumn => qualityPolicies.id, {
      onDelete: 'set null',
    }),
    idempotencyKey: text('idempotency_key'),
    retryOfRunId: uuid('retry_of_run_id').references((): AnyPgColumn => runs.id, {
      onDelete: 'set null',
    }),
    runnerId: uuid('runner_id').references(() => runners.id, { onDelete: 'set null' }),
    currentJobId: uuid('current_job_id').references((): AnyPgColumn => executionJobs.id, {
      onDelete: 'set null',
    }),
    eventSequence: integer('event_sequence').notNull().default(0),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    cancelRequestedBy: text('cancel_requested_by'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    errorDetails: jsonb('error_details').$type<Record<string, unknown>>(),
    rawEvidenceRefs: jsonb('raw_evidence_refs').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    // The contract's five values, from the shared vocabulary rather than a
    // hand-written list here. This used to be `['passed','failed','skipped']`, which
    // disagreed with `GateStatusSchema` in `@lupin/shared-contracts` in both
    // directions: it accepted `skipped`, which the contract does not define, and it
    // rejected `warning`, `unknown` and `not_evaluated`, which it does. The two lists
    // could not be compared by the compiler — `execution.ts` imports from this module,
    // so the constant could not be imported back from there — and so nothing noticed
    // (ledger P-5). `0016_gate_status_contract.sql` widens the CHECK to match.
    gateStatus: text('gate_status', { enum: GATE_STATUSES }),
    // NOT NULL with a key onto `workspaces` since 0028 (ledger MNT-17). It was nullable
    // with no key, so a run could belong to no workspace — invisible to every scoped
    // read — or to one `workspaces` never registered.
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    prNumber: integer('pr_number'),
    prBranch: text('pr_branch'),
    baseBranch: text('base_branch'),
    commitAuthor: text('commit_author'),
  },
  (t) => [
    uniqueIndex('runs_workspace_external_source_unique').on(t.workspaceId, t.source, t.externalId),
    uniqueIndex('runs_workspace_idempotency_unique').on(t.workspaceId, t.idempotencyKey),
    index('runs_started_at_idx').on(t.startedAt),
    index('runs_finished_at_idx').on(t.finishedAt),
    index('runs_workspace_id_idx').on(t.workspaceId),
    // Added in migration 0014. `runs_workspace_id_idx` alone made the dashboard's
    // listing — `WHERE workspace_id = $1 ORDER BY created_at ASC, id ASC LIMIT n` —
    // locate the workspace's rows by index and then **sort** them, so taking 25 rows
    // cost a sort of the workspace's entire history. This composite is in the query's
    // own order, so the page is an ordered index scan with no sort, and the `id`
    // tiebreak needs no re-sort either. That is the cost the pagination was added to
    // remove; the EXPLAIN fixture found that it had not.
    index('runs_workspace_created_idx').on(t.workspaceId, t.createdAt, t.id),
    index('runs_branch_idx').on(t.branch),
    index('runs_status_idx').on(t.status),
    index('runs_phase_outcome_idx').on(t.workspaceId, t.phase, t.outcome),
    index('runs_project_created_idx').on(t.projectId, t.startedAt),
    index('runs_environment_created_idx').on(t.environmentId, t.startedAt),
    index('runs_release_created_idx').on(t.releaseId, t.startedAt),
    index('runs_runner_idx').on(t.runnerId),
    index('runs_current_job_idx').on(t.currentJobId),
    index('runs_retry_of_idx').on(t.retryOfRunId),
    index('runs_pr_number_idx').on(t.prNumber),
    index('runs_commit_idx').on(t.commit),
    index('runs_commit_sha_idx').on(t.commitSha),
    check(
      'runs_phase_check',
      sql`${t.phase} in ('queued', 'assigned', 'preparing', 'running', 'collecting', 'normalizing', 'analyzing', 'gate_evaluation', 'complete', 'cancelled', 'timed_out', 'runner_lost', 'infra_failed', 'config_failed', 'blocked', 'partial')`,
    ),
    check(
      'runs_outcome_check',
      sql`${t.outcome} is null or ${t.outcome} in ('passed', 'failed', 'unknown', 'partial', 'cancelled', 'timed_out', 'runner_lost', 'infra_failed', 'config_failed', 'blocked')`,
    ),
    check(
      'runs_phase_outcome_check',
      sql`(${t.phase} in ('complete', 'cancelled', 'timed_out', 'runner_lost', 'infra_failed', 'config_failed', 'blocked', 'partial')) = (${t.outcome} is not null)`,
    ),
    check('runs_attempt_check', sql`${t.attempt} > 0`),
    check('runs_event_sequence_check', sql`${t.eventSequence} >= 0`),
    check('runs_timeout_check', sql`${t.timeoutMs} is null or ${t.timeoutMs} > 0`),
    check(
      'runs_summary_check',
      sql`${t.total} >= 0 and ${t.passed} >= 0 and ${t.failed} >= 0 and ${t.flaky} >= 0 and ${t.skipped} >= 0 and ${t.blocked} >= 0 and ${t.unknown} >= 0`,
    ),
  ],
);

export const canonicalRunResults = pgTable(
  'canonical_run_results',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    runId: text('run_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.runId] }),
    index('canonical_run_results_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
);

// ─── tests ─────────────────────────────────────────────────────────────────
// Source: tests table — individual test instances per run (composite PK)
//
// Every table from here down that holds a run's evidence carries the run's workspace
// (0028, ledger MNT-17): NOT NULL, a `restrict` key onto `workspaces`, and an index that
// leads with it. The migration fills it from the parent row, never from a caller.
export const tests = pgTable(
  'tests',
  {
    // SQLite: text('id').notNull() // Playwright testId (composite PK)
    id: text('id').notNull(),
    // SQLite: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' })
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    // No key since 0066: the `suites` table it named was dropped (ledger C-6). The value stays.
    suiteId: text('suite_id'),
    title: text('title').notNull(),
    file: text('file').notNull(),
    line: integer('line'),
    column: integer('column'),
    // The test's identity across runs — `testIdentity` in `@lupin/shared-contracts`.
    // NOT NULL since 0045, which backfilled it and fills it on insert for a writer that
    // does not send it.
    stableId: text('stable_id').notNull(),
    status: text('status', {
      // `timed_out` and `timedOut` were both accepted here. Nothing writes or
      // reads the camelCase spelling — `testStatus()` maps it to `unknown` on
      // the way back out — so a `timedOut` row was a timed-out test that read as
      // unobserved, and a `GROUP BY status` split one logical state into two
      // rows. Migration 0007 normalises any such row and adds the CHECK.
      enum: [
        'passed',
        'failed',
        'flaky',
        'skipped',
        'timed_out',
        'running',
        'queued',
        'blocked',
        'cancelled',
        'unknown',
      ],
    })
      .notNull()
      .default('queued'),
    durationMs: integer('duration_ms'),
    // SQLite: text('tags') // JSON array
    tags: jsonb('tags'),
    // SQLite: text('annotations') // JSON array
    annotations: jsonb('annotations'),
    retryCount: integer('retry_count').default(0),
    expectedStatus: text('expected_status'),
    workerIndex: integer('worker_index'),
    // **Why a test failed**, as the reporter stated it.
    //
    // These two columns did not exist, and the reporter has been sending them the whole
    // time: `TestEndPayloadSchema` is `.passthrough()`, so `error: { code, message }` was
    // *accepted* and then written nowhere, because `upsertTest`/`patchTest` had nowhere to
    // put it. The product therefore knew a test failed and had no idea why — and the
    // dashboard, whose entire purpose is showing the evidence, rendered a red row with no
    // reason on it.
    //
    // Additive, nullable, no backfill: a row written before this migration has no
    // message, which is the honest state for a row that was recorded without one. The
    // UI renders absence as "no message reported" rather than as a blank.
    //
    // Capped in the handler, not here — see `normaliseFailure` in
    // `apps/api/src/services/reporter-persistence.ts`, which is where an untrusted
    // producer's payload is bounded. A `text` column with no length is a place a
    // producer can write a megabyte into a row that a dashboard then renders.
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (t) => [
    // SQLite: primaryKey({ columns: [t.id, t.runId] })
    primaryKey({ columns: [t.id, t.runId] }),
    index('tests_run_id_idx').on(t.runId),
    index('tests_workspace_run_idx').on(t.workspaceId, t.runId),
    // Per-test history reads one test in one workspace, so the boundary leads (0045).
    index('tests_workspace_stable_id_idx').on(t.workspaceId, t.stableId),
    // The enum is compile-time only, so the spellings it permits are not
    // enforced by the database. Without this a second spelling of a state can
    // reappear and split every aggregation.
    check(
      'tests_status_check',
      sql`${t.status} in ('passed', 'failed', 'flaky', 'skipped', 'timed_out', 'running', 'queued', 'blocked', 'cancelled', 'unknown')`,
    ),
  ],
);

// ─── trends ────────────────────────────────────────────────────────────────
// Source: trends table — daily aggregates for analytics charts (composite PK)
//
// The key leads with the workspace since 0028: `(date, project, branch)` alone made two
// workspaces with a project of the same name one row.
export const trends = pgTable(
  'trends',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    date: text('date').notNull(),
    project: text('project').notNull(),
    branch: text('branch').notNull().default('main'),
    total: integer('total').notNull().default(0),
    passed: integer('passed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    flaky: integer('flaky').notNull().default(0),
    // SQLite: real('avg_duration_ms')
    avgDurationMs: real('avg_duration_ms'),
    p95DurationMs: real('p95_duration_ms'),
    /**
     * Written by the daily rollup since `0064` (plan task 13), one row per day and project
     * (`''` for every project) with branch `''` for every branch: what a trend bucket holds.
     */
    other: integer('other').notNull().default(0),
    tests: integer('tests').notNull().default(0),
    testsFailed: integer('tests_failed').notNull().default(0),
    flakyTests: integer('flaky_tests').notNull().default(0),
    /** Runs with a duration, so a window's mean duration can be weighted correctly. */
    timedRuns: integer('timed_runs').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.date, t.project, t.branch] })],
);

// ─── quarantine ────────────────────────────────────────────────────────────
// Source: quarantine table — quarantined flaky tests
export const quarantine = pgTable(
  'quarantine',
  {
    id: text('id').primaryKey(),
    // Added by 0028 (ledger MNT-17). There was no column, so the list, the resolve and
    // the delete answered for the whole installation, and the readiness card counted
    // every workspace's pending entries as one.
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    testTitle: text('test_title').notNull(),
    testFile: text('test_file').notNull(),
    // The test's identity (0046). `null` for an entry recorded before identities, which
    // matches by title and file in every project — `excuseQuarantined` in the API.
    stableId: text('stable_id'),
    reason: text('reason'),
    // SQLite: text('quarantined_at').notNull()
    quarantinedAt: timestamp('quarantined_at', { withTimezone: true }).notNull(),
    quarantinedBy: text('quarantined_by').default('manual'),
    // Fails closed: a newly quarantined test starts as `pending` (not excluded
    // from the pass rate) until a human resolves it. The previous default,
    // `approved`, meant a test entered the quarantine and was immediately
    // hidden from reporting with nobody deciding that.
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'released'] })
      .notNull()
      .default('pending'),
    flakinessCategory: text('flakiness_category'),
    // SQLite: real('category_confidence')
    categoryConfidence: real('category_confidence'),
    // SQLite: text('category_evidence') // JSON string of string[]
    categoryEvidence: jsonb('category_evidence'),
    // SQLite: text('resolved_at')
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionType: text('resolution_type'),
    ttfMs: integer('ttf_ms'),
    // 0047. When an approved entry stopped excusing its test; set exactly when `released`.
    releasedAt: timestamp('released_at', { withTimezone: true }),
    // 0047. The project whose test this is; `null` matches the test in any project.
    projectId: uuid('project_id').references((): AnyPgColumn => projects.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => [
    check(
      'quarantine_released_at_check',
      sql`(${table.status} = 'released') = (${table.releasedAt} is not null)`,
    ),
    // A time-to-fix is a claim that the problem was fixed; it cannot exist
    // without a resolution.
    check(
      'quarantine_ttf_resolution_check',
      sql`${table.ttfMs} is null or ${table.resolvedAt} is not null`,
    ),
    // Added in migration 0014. `quarantine` had **no** index, so
    // `GET /api/v1/dashboard/quarantine` — which is `ORDER BY quarantined_at` —
    // sorted the whole table on every dashboard load, and the cost grew with every
    // entry ever quarantined. Found by `tests/integration`'s EXPLAIN fixture, which
    // states for each hot query the index it is served by.
    index('quarantine_quarantined_idx').on(table.quarantinedAt),
    // The listing as it now runs: one workspace, in quarantine order (0028).
    index('quarantine_workspace_quarantined_idx').on(table.workspaceId, table.quarantinedAt),
    // 0046: the gate reads one workspace's entries for the identities a run reported.
    index('quarantine_workspace_stable_id_idx').on(table.workspaceId, table.stableId),
    index('quarantine_workspace_project_idx').on(table.workspaceId, table.projectId),
  ],
);

// ─── schedules ─────────────────────────────────────────────────────────────
// Source: schedules table — cron-based scheduled runs
export const schedules = pgTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    cronExpr: text('cron_expr').notNull(),
    // SQLite: text('run_options') // JSON
    runOptions: jsonb('run_options'),
    // SQLite: integer('enabled', { mode: 'boolean' })
    enabled: boolean('enabled').default(true),
    // The tenant this schedule runs in, and `NOT NULL` because a schedule that names no
    // workspace has no correct one to default to.
    //
    // Added in `0015_schedule_workspace_scope.sql`. It used to exist only as
    // `run_options->'request'->>'workspaceId'` — a string inside untyped JSONB, which
    // meant the worker had nothing to scope its read by and nothing to validate the value
    // against, so any principal able to insert a schedule chose the workspace its run
    // executed in. With a column, the worker takes the workspace from here and refuses a
    // row whose `run_options` disagrees.
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    // SQLite: text('last_run_at')
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    // SQLite: text('created_at').notNull()
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  // Created by 0015 for the due-schedule read; declared so a regenerated snapshot keeps it.
  (table) => [
    index('schedules_workspace_due_idx')
      .on(table.workspaceId, table.lastRunAt)
      .where(sql`enabled = true`),
  ],
);

// ─── quality gate config ───────────────────────────────────────────────────
// Source: quality_gate_config table — global + per-workspace quality gate thresholds
export const qualityGateConfig = pgTable(
  'quality_gate_config',
  {
    id: text('id').primaryKey().default('global'),
    // **Nullable by design**, and the only `workspace_id` in the schema that is. NULL is
    // the installation-wide default gate (`global`) and every gate the dashboard creates;
    // a value scopes a per-workspace override. 0028 adds the `restrict` key so a gate
    // that names a workspace names a real one, and keeps the NULLs — forcing a value
    // would turn the installation default into one workspace's private gate. The tenancy
    // register classifies this table `global` for that reason.
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'restrict' }),
    /**
     * The project this gate governs, added in 0024.
     *
     * **A column, not a second thresholds table** — plan task 9. The table is
     * already read and written by the gate evaluation path, so a
     * `project_thresholds` table would have had neither for as long as it existed,
     * and would have left two places answering "what is this project's pass-rate
     * threshold", of which one is the answer nobody reads.
     *
     * `NULL` is the workspace-wide default gate, which is why this is nullable for
     * the same reason `workspace_id` above is. A row with `project_id IS NULL` is
     * the fallback for every project that has not declared its own.
     *
     * `cascade`, which is the opposite of `runs.project_id`'s `set null`: a run is
     * evidence and outlives the registry entry, while a threshold *about* a
     * project describes nothing once the project is gone.
     */
    projectId: uuid('project_id').references((): AnyPgColumn => projects.id, {
      onDelete: 'cascade',
    }),
    // The gate's own display name. It used to be stored in `workspace_id` and read
    // back out of it, which scoped every created gate to a workspace that did not
    // exist and made the scoping column carry a free-text label. Migration 0012
    // moved it here and recovered the names it had swallowed.
    name: text('name').notNull().default('Unnamed gate'),
    // SQLite: real('pass_rate_threshold').notNull().default(100)
    passRateThreshold: real('pass_rate_threshold').notNull().default(100),
    maxDurationMs: integer('max_duration_ms'),
    maxFlakyCount: integer('max_flaky_count'),
    maxQuarantinePercent: real('max_quarantine_percent'),
    // SQLite: text('updated_at').notNull()
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  // Added in 0024, alongside the column: the gate reader filters on
  // `(workspace_id, project_id)` and had no index at all, so a per-project lookup
  // scanned every gate row in the install.
  (table) => [
    index('quality_gate_config_workspace_project_idx').on(table.workspaceId, table.projectId),
  ],
);

// ─── defect categories ─────────────────────────────────────────────────────
// Source: defect_categories table — named defect categories
export const defectCategories = pgTable('defect_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color').notNull().default('#6b7280'),
  // SQLite: text('created_at').notNull()
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// Source: fingerprint_categories table — a workspace's triage label for a failure signature.
// Workspace-scoped since 0048: a label is a team's decision about its own failures.
export const fingerprintCategories = pgTable(
  'fingerprint_categories',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    /** `failureSignature` from `@lupin/reporting`. */
    fingerprint: text('fingerprint').notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => defectCategories.id, { onDelete: 'cascade' }),
    // SQLite: text('assigned_at').notNull()
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
    issueUrl: text('issue_url'),
    /** Why a cause is known, when there is no issue to link (plan task 12, `0063`). */
    reason: text('reason'),
    labelledBy: text('labelled_by').notNull().default('manual'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.fingerprint] })],
);

// ─── test failure correlations ─────────────────────────────────────────────
// Source: test_failure_correlations table — source-file ↔ test failure correlation window
export const testFailureCorrelations = pgTable(
  'test_failure_correlations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    testStableId: text('test_stable_id').notNull(),
    sourceFilePath: text('source_file_path').notNull(),
    failureCount: integer('failure_count').notNull().default(0),
    totalOccurrences: integer('total_occurrences').notNull().default(0),
    lastUpdatedRunId: uuid('last_updated_run_id').references(() => runs.id, {
      onDelete: 'cascade',
    }),
    // SQLite: text('window_start_date').notNull()
    windowStartDate: timestamp('window_start_date', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // Per workspace since 0028: unique on its own, one tenant's correlation for a test
    // and file suppressed another's.
    uniqueIndex('test_failure_correlations_workspace_test_file_unique').on(
      t.workspaceId,
      t.testStableId,
      t.sourceFilePath,
    ),
  ],
);

// ─── failure_clusters ─────────────────────────────────────────────────────────
// Source: failure_clusters table — cross-run error cluster groups
export const failureClusters = pgTable(
  'failure_clusters',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    fingerprint: text('fingerprint').notNull(),
    clusterLabel: text('cluster_label').notNull(),
    firstSeenRunId: uuid('first_seen_run_id'),
    lastSeenRunId: uuid('last_seen_run_id'),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    representativeError: text('representative_error').notNull(),
    category: text('category'),
    status: text('status', { enum: ['active', 'resolved'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    /**
     * Written by the cluster job since `0063` (plan task 11): the project the clusters were
     * computed for, `''` for every project, and what the Tests page shows of each cause.
     * `fingerprint` is the cause's `failureSignature`, as `fingerprint_categories` keys it.
     */
    projectKey: text('project_key').notNull().default(''),
    errorType: text('error_type'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    runCount: integer('run_count').notNull().default(0),
    tests: jsonb('tests').$type<string[]>().notNull().default([]),
    branches: jsonb('branches').$type<string[]>().notNull().default([]),
  },
  (t) => [
    index('failure_clusters_fingerprint_idx').on(t.fingerprint),
    index('failure_clusters_status_idx').on(t.status),
    index('failure_clusters_workspace_fingerprint_idx').on(t.workspaceId, t.fingerprint),
    uniqueIndex('failure_clusters_scope_idx').on(t.workspaceId, t.projectKey, t.fingerprint),
  ],
);

// ─── users ────────────────────────────────────────────────────────────────────
// Source: users table — user accounts
export const users = pgTable(
  'users',
  {
    // SQLite: text('id').primaryKey() // UUID
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['admin', 'editor', 'viewer'] })
      .notNull()
      .default('viewer'),
    samlSubject: text('saml_subject'),
    tenantId: text('tenant_id'),
    /**
     * The identity a sign-in names, since `0049_workspace_members.sql`: the provider's issuer
     * and its subject, unique together. `role` and `tenantId` above predate it and are read by
     * nothing; a person's role is per workspace, in `workspace_members`.
     */
    issuer: text('issuer'),
    subject: text('subject'),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** The identity provider's id for a person it provisioned over SCIM (`0051_scim_tokens.sql`). */
    externalId: text('external_id'),
    // SQLite: text('created_at').notNull()
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    uniqueIndex('users_issuer_subject_idx').on(t.issuer, t.subject),
    index('users_external_id_idx').on(t.externalId),
  ],
);

/**
 * The sealed envelope `saml_config.sp_private_key` holds.
 *
 * A structural copy of the vault's `VaultEnvelope`, because `packages/db` is a leaf and
 * must not depend on the API. Structural rather than duplicated-without-comment: a type
 * import is impossible across that boundary, so the shape is written where it is used
 * and the vault is the definition of record.
 */
interface VaultEnvelopeShape {
  version: 1 | 2;
  algorithm: 'aes-256-gcm';
  keyVersion: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

// ─── saml_config ──────────────────────────────────────────────────────────────
// Source: saml_config table — SAML SSO configuration
export const samlConfig = pgTable('saml_config', {
  id: text('id').primaryKey(),
  entryPoint: text('entry_point').notNull(),
  issuer: text('issuer').notNull(),
  idpCert: text('idp_cert').notNull(),
  callbackUrl: text('callback_url').notNull(),
  /**
   * The Service Provider private key, as a sealed vault envelope.
   *
   * Was `text`, holding the key in the clear, while everything else this repository
   * treats as a secret went through the vault — so a database dump yielded the key, and
   * a SP private key is what an attacker needs to authenticate *as this installation* to
   * every relying party that trusts it (ledger P-21).
   *
   * Typed as the same `VaultEnvelope` the vault uses, and sealed with the row bound as
   * GCM additional authenticated data, so the key cannot be moved to another SAML
   * configuration and opened there. `packages/db` cannot import the vault module — it
   * is a leaf — so the envelope shape is stated here and the sealing happens at the API
   * layer, which is the layer that holds the installation secret.
   *
   * `0019_sp_private_key_sealed.sql` will not convert an existing plaintext value:
   * sealing needs the secret, which a migration does not have, and a jsonb column
   * holding plaintext would assert a protection the data does not have.
   */
  spPrivateKey: jsonb('sp_private_key').$type<VaultEnvelopeShape>(),
  defaultRole: text('default_role', { enum: ['viewer', 'editor', 'admin'] })
    .notNull()
    .default('viewer'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ─── audit_events ─────────────────────────────────────────────────────────────
// Source: audit_events table — immutable audit trail
export const auditEvents = pgTable(
  'audit_events',
  {
    // SQLite: text('id').primaryKey() // UUID
    id: uuid('id').primaryKey().defaultRandom(),
    // SQLite: text('timestamp').notNull() // ISO-8601 UTC
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    actorId: text('actor_id').notNull(),
    actorType: text('actor_type', { enum: ['user', 'system', 'service'] })
      .notNull()
      .default('user'),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    // SQLite: text('details') // JSON blob
    details: jsonb('details'),
    // NOT NULL with a key onto `workspaces` since 0028 (ledger MNT-17). Every production
    // writer wrote NULL, because nothing in the dashboard module knew the workspace.
    //
    // `tenant_id` sat beside it and was dropped by the same migration: a second tenant
    // column with no writer and no reader, not constrained to agree with this one, so a
    // reader could not tell which the writer meant. The migration folded any value into
    // this column and refused a disagreement rather than discarding it.
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /**
     * The row's place in its workspace's hash chain, since `0050_audit_chain.sql`. Written by
     * the insert trigger and never by application code; `audit_chain_breaks` checks them.
     */
    chainSeq: bigint('chain_seq', { mode: 'number' }),
    prevHash: text('prev_hash'),
    hash: text('hash'),
  },
  (t) => [
    index('audit_events_actor_idx').on(t.actorId),
    index('audit_events_action_idx').on(t.action),
    index('audit_events_timestamp_idx').on(t.timestamp),
    index('audit_events_workspace_timestamp_idx').on(t.workspaceId, t.timestamp),
    uniqueIndex('audit_events_workspace_chain_idx').on(t.workspaceId, t.chainSeq),
  ],
);

// ─── Inferred types ───────────────────────────────────────────────────────────
export type Run = typeof runs.$inferSelect;
export type InsertRun = typeof runs.$inferInsert;
export type Test = typeof tests.$inferSelect;
export type InsertTest = typeof tests.$inferInsert;
export type Trend = typeof trends.$inferSelect;
export type InsertTrend = typeof trends.$inferInsert;
export type Quarantine = typeof quarantine.$inferSelect;
export type InsertQuarantine = typeof quarantine.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = typeof schedules.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = typeof workspaces.$inferInsert;
export type Runner = typeof runners.$inferSelect;
export type InsertRunner = typeof runners.$inferInsert;
export type QualityGateConfig = typeof qualityGateConfig.$inferSelect;
export type InsertQualityGateConfig = typeof qualityGateConfig.$inferInsert;
export type DefectCategory = typeof defectCategories.$inferSelect;
export type InsertDefectCategory = typeof defectCategories.$inferInsert;
export type FingerprintCategory = typeof fingerprintCategories.$inferSelect;
export type InsertFingerprintCategory = typeof fingerprintCategories.$inferInsert;
export type TestFailureCorrelation = typeof testFailureCorrelations.$inferSelect;
export type InsertTestFailureCorrelation = typeof testFailureCorrelations.$inferInsert;
export type FailureCluster = typeof failureClusters.$inferSelect;
export type InsertFailureCluster = typeof failureClusters.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type SamlConfig = typeof samlConfig.$inferSelect;
export type InsertSamlConfig = typeof samlConfig.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;
