-- Quiet hours for a scheduled report: a start and an end hour in the subscription's own
-- timezone, during which nothing is delivered. A report that comes due inside them waits
-- until they end. Both null (every pre-existing row) is no quiet hours; one without the other,
-- an hour outside 0-23, or a window that starts where it ends, is refused by the database.
-- The worker reads its copy from the schedule's `run_options`, as it reads the timezone.
ALTER TABLE "report_subscriptions" ADD COLUMN IF NOT EXISTS "quiet_start" smallint;
--> statement-breakpoint
ALTER TABLE "report_subscriptions" ADD COLUMN IF NOT EXISTS "quiet_end" smallint;
--> statement-breakpoint
ALTER TABLE "report_subscriptions" ADD CONSTRAINT "report_subscriptions_quiet_hours_check"
  CHECK (
    ("quiet_start" IS NULL AND "quiet_end" IS NULL)
    OR (
      "quiet_start" IS NOT NULL
      AND "quiet_end" IS NOT NULL
      AND "quiet_start" BETWEEN 0 AND 23
      AND "quiet_end" BETWEEN 0 AND 23
      AND "quiet_start" <> "quiet_end"
    )
  );
