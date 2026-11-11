import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { projects, workspaces } from './dashboard.js';

// ─── Change risk ────────────────────────────────────────────────────────────
//
// Two tables, added in `0058_change_risk.sql`, each hard-scoped from its first migration:
// `workspace_id` NOT NULL, a `restrict` key onto `workspaces`, and an index that leads with it.
// `ON DELETE CASCADE` on the project, as the delivery tables have.
//
// **No source is stored here.** A tamper report is kinds, paths and line numbers, which is
// all `lupin diff-guard` sends; an assessment is points and sentences the model wrote.

/**
 * What `lupin diff-guard` found on one commit: the changes that weaken the tests judging it.
 * One row per (workspace, project, commit), upserted, and bounded by the writer to the 5000
 * most recently reported per project.
 */
export const testTamperReports = pgTable(
  'test_tamper_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    /** The ref the diff was read against, as the job named it (`origin/main`). */
    base: text('base').notNull(),
    branch: text('branch'),
    prNumber: integer('pr_number'),
    version: text('version').notNull(),
    /** Every finding by kind, including the ones past the report's limit. */
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    /** At most 200 `{ kind, path, line, side }`. Never the text of a line. */
    findings: jsonb('findings')
      .$type<Array<{ kind: string; path: string; line: number | null; side: string }>>()
      .notNull()
      .default([]),
    filesChecked: integer('files_checked').notNull().default(0),
    truncated: boolean('truncated').notNull().default(false),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('test_tamper_reports_commit_idx').on(
      table.workspaceId,
      table.projectId,
      table.commitSha,
    ),
    index('test_tamper_reports_recent_idx').on(
      table.workspaceId,
      table.projectId,
      table.reportedAt,
    ),
    check(
      'test_tamper_reports_counts_check',
      sql`${table.filesChecked} >= 0 AND (${table.prNumber} IS NULL OR ${table.prNumber} >= 1)`,
    ),
  ],
);

/**
 * A pull request's change risk at one head commit, as the gate assessed it. One row per
 * (workspace, project, pull request, head), so the history across pushes is kept, bounded by
 * the writer to the 5000 most recently assessed per project.
 */
export const pullRequestRiskAssessments = pgTable(
  'pull_request_risk_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    level: text('level').notNull(),
    score: integer('score').notNull(),
    /** The points table it was scored with: `change-risk/1`. */
    version: text('version').notNull(),
    factors: jsonb('factors')
      .$type<
        Array<{
          id: string;
          kind: string;
          points: number;
          detail: string;
          evidence: string | null;
        }>
      >()
      .notNull()
      .default([]),
    missing: jsonb('missing').$type<string[]>().notNull().default([]),
    /** Sensitive areas, owning teams (never people), linked tests, truncation. */
    blastRadius: jsonb('blast_radius').$type<Record<string, unknown>>(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pull_request_risk_assessments_head_idx').on(
      table.workspaceId,
      table.projectId,
      table.prNumber,
      table.headSha,
    ),
    index('pull_request_risk_assessments_recent_idx').on(
      table.workspaceId,
      table.projectId,
      table.assessedAt,
    ),
    check(
      'pull_request_risk_assessments_level_check',
      sql`${table.level} IN ('low', 'medium', 'unknown', 'high', 'critical')`,
    ),
    check(
      'pull_request_risk_assessments_counts_check',
      sql`${table.prNumber} >= 1 AND ${table.score} >= 0`,
    ),
  ],
);

export type TestTamperReportRow = InferSelectModel<typeof testTamperReports>;
export type PullRequestRiskAssessmentRow = InferSelectModel<typeof pullRequestRiskAssessments>;
