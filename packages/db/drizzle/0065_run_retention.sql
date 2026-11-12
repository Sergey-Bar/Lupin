ALTER TABLE "workspaces" ADD COLUMN "run_retention_days" integer;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_run_retention_check" CHECK ("run_retention_days" IS NULL OR "run_retention_days" >= 1);
