import {
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

// ─── The GitHub command center ───────────────────────────────────────────────
//
// Two tables, added in `0054_github_command_center.sql`, each hard-scoped from its first
// migration: `workspace_id` NOT NULL, a `restrict` key onto `workspaces`, and an index that
// leads with it. Pull requests are not here: they are `pull_requests` in `delivery.ts`, which
// the same sync fills, and which gained the review, checks and mergeability columns.
//
// **No token is stored here.** A project's GitHub token is the vault entry `git:<projectId>`.

/** An issue as GitHub last described it. Pull requests are not issues here. */
export const githubIssues = pgTable(
  'github_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    number: integer('number').notNull(),
    state: text('state').notNull(),
    title: text('title').notNull(),
    authorLogin: text('author_login'),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    assignees: jsonb('assignees').$type<string[]>().notNull().default([]),
    commentCount: integer('comment_count').notNull().default(0),
    htmlUrl: text('html_url'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_issues_external_idx').on(
      table.workspaceId,
      table.projectId,
      table.externalId,
    ),
    index('github_issues_activity_idx').on(
      table.workspaceId,
      table.projectId,
      table.lastActivityAt,
    ),
    check('github_issues_state_check', sql`${table.state} IN ('open', 'closed')`),
  ],
);

/**
 * What the last sync learned about a repository as a whole: its community profile, the default
 * branch's protection, the open security alerts, and how much request budget was left. One row
 * per project, replaced by every sync.
 *
 * Each of `protection` and `alerts` records `unavailable` when the token may not see it, which
 * is a different fact from "none", so a repository is never graded on something nobody read.
 */
export const repoGithubState = pgTable(
  'repo_github_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** `{ license, securityPolicy, codeOfConduct, contributing, issueTemplate, prTemplate, readme, healthPercentage }`. */
    community: jsonb('community'),
    /** `{ state: 'protected' | 'unprotected' | 'unavailable', requiresReview, requiresChecks }`. */
    protection: jsonb('protection'),
    /** `{ dependabot, codeScanning, secretScanning }`, each a severity count or `unavailable`. */
    alerts: jsonb('alerts'),
    /** `{ limit, remaining, resetAt }` as GitHub last reported it. */
    rateLimit: jsonb('rate_limit'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('repo_github_state_project_idx').on(table.workspaceId, table.projectId)],
);

export type GithubIssueRow = InferSelectModel<typeof githubIssues>;
export type RepoGithubStateRow = InferSelectModel<typeof repoGithubState>;
