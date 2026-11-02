-- The GitHub command center: what a person needs to triage a repository from one place.
--
-- `pull_requests` gains the four facts a triage view sorts on (link, review decision, checks
-- rollup, mergeability) and who has been asked to review. Two tables are new:
--
--   `github_issues`      issues as GitHub last described them (pull requests are not issues here)
--   `repo_github_state`  one row per project: community profile, default-branch protection, open
--                        security alerts, and the request budget GitHub reported
--
-- Each new table is hard-scoped from its first migration: `workspace_id` NOT NULL, a `restrict`
-- key onto `workspaces`, and an index that leads with it. Nothing here stores a token.

ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "html_url" text;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "review_decision" text;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "checks_state" text;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "mergeable_state" text;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "requested_reviewers" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_review_decision_check"
  CHECK ("review_decision" IS NULL OR "review_decision" IN ('approved', 'changes_requested', 'review_required'));
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_checks_state_check"
  CHECK ("checks_state" IS NULL OR "checks_state" IN ('success', 'failure', 'pending'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "external_id" text NOT NULL,
  "number" integer NOT NULL,
  "state" text NOT NULL,
  "title" text NOT NULL,
  "author_login" text,
  "labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "comment_count" integer DEFAULT 0 NOT NULL,
  "html_url" text,
  "opened_at" timestamp with time zone NOT NULL,
  "closed_at" timestamp with time zone,
  "last_activity_at" timestamp with time zone NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_issues_state_check" CHECK ("state" IN ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repo_github_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "community" jsonb,
  "protection" jsonb,
  "alerts" jsonb,
  "rate_limit" jsonb,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_issues" ADD CONSTRAINT "github_issues_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "github_issues" ADD CONSTRAINT "github_issues_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "repo_github_state" ADD CONSTRAINT "repo_github_state_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "repo_github_state" ADD CONSTRAINT "repo_github_state_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "github_issues_external_idx"
  ON "github_issues" USING btree ("workspace_id", "project_id", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_issues_activity_idx"
  ON "github_issues" USING btree ("workspace_id", "project_id", "last_activity_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repo_github_state_project_idx"
  ON "repo_github_state" USING btree ("workspace_id", "project_id");

