ALTER TABLE "trends" ADD COLUMN "other" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trends" ADD COLUMN "tests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trends" ADD COLUMN "tests_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trends" ADD COLUMN "flaky_tests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trends" ADD COLUMN "timed_runs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trends" ADD COLUMN "updated_at" timestamp with time zone;