-- Change risk: what `lupin diff-guard` found on a commit, and a pull request's assessed risk
-- at each head. Both hard-scoped from their first migration: `workspace_id` NOT NULL, a
-- `restrict` key onto `workspaces`, and indexes that lead with it. No source is stored: a
-- tamper report is kinds, paths and line numbers.
CREATE TABLE IF NOT EXISTS "test_tamper_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "commit_sha" text NOT NULL,
  "base" text NOT NULL,
  "branch" text,
  "pr_number" integer,
  "version" text NOT NULL,
  "counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "files_checked" integer DEFAULT 0 NOT NULL,
  "truncated" boolean DEFAULT false NOT NULL,
  "reported_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "test_tamper_reports_counts_check"
    CHECK ("files_checked" >= 0 AND ("pr_number" IS NULL OR "pr_number" >= 1))
);
--> statement-breakpoint
ALTER TABLE "test_tamper_reports"
  ADD CONSTRAINT "test_tamper_reports_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "test_tamper_reports"
  ADD CONSTRAINT "test_tamper_reports_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "test_tamper_reports_commit_idx"
  ON "test_tamper_reports" ("workspace_id", "project_id", "commit_sha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_tamper_reports_recent_idx"
  ON "test_tamper_reports" ("workspace_id", "project_id", "reported_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pull_request_risk_assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "pr_number" integer NOT NULL,
  "head_sha" text NOT NULL,
  "level" text NOT NULL,
  "score" integer NOT NULL,
  "version" text NOT NULL,
  "factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "blast_radius" jsonb,
  "assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pull_request_risk_assessments_level_check"
    CHECK ("level" IN ('low', 'medium', 'unknown', 'high', 'critical')),
  CONSTRAINT "pull_request_risk_assessments_counts_check"
    CHECK ("pr_number" >= 1 AND "score" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pull_request_risk_assessments"
  ADD CONSTRAINT "pull_request_risk_assessments_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "pull_request_risk_assessments"
  ADD CONSTRAINT "pull_request_risk_assessments_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pull_request_risk_assessments_head_idx"
  ON "pull_request_risk_assessments" ("workspace_id", "project_id", "pr_number", "head_sha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_request_risk_assessments_recent_idx"
  ON "pull_request_risk_assessments" ("workspace_id", "project_id", "assessed_at");
