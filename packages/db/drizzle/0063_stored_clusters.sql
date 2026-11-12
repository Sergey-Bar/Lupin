ALTER TABLE "failure_clusters" ADD COLUMN "project_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "error_type" text;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "run_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "tests" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "branches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fingerprint_categories" ADD COLUMN "reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "failure_clusters_scope_idx" ON "failure_clusters" USING btree ("workspace_id","project_key","fingerprint");