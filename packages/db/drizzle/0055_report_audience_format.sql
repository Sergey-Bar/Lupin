-- A scheduled report gains an audience and a format (daily-export upgrade). Additive only.
--
-- `audience` tunes who the report leads for: `manager` leads with DORA, flow and readiness;
-- `sdet` with flaky tests, failure clusters and diff coverage; `quality` with test
-- effectiveness, supply chain and governance; `general` is the report exactly as it was. It is
-- null for every pre-existing row and read as `general`, so nothing changes until a reader
-- chooses otherwise.
--
-- `format` is how much the report carries: `chat` is the tiny digest the five chat platforms
-- receive; `full` is the richer self-contained HTML artifact, for a channel that can carry it
-- (email, or a download). Null is read as `chat`, so every pre-existing subscription keeps the
-- digest it already sent.
--
-- Both are nullable rather than defaulted so the "unset, read as the safe default" state is
-- distinguishable from a deliberate `general`/`chat`, and so no backfill touches existing rows.
-- The CHECKs admit null plus the named values, which is what keeps a typo out of the column.

ALTER TABLE "report_subscriptions" ADD COLUMN IF NOT EXISTS "audience" text;
--> statement-breakpoint
ALTER TABLE "report_subscriptions" ADD COLUMN IF NOT EXISTS "format" text;
--> statement-breakpoint
ALTER TABLE "report_subscriptions"
  ADD CONSTRAINT "report_subscriptions_audience_check"
  CHECK ("audience" IS NULL OR "audience" IN ('general', 'manager', 'sdet', 'quality'));
--> statement-breakpoint
ALTER TABLE "report_subscriptions"
  ADD CONSTRAINT "report_subscriptions_format_check"
  CHECK ("format" IS NULL OR "format" IN ('chat', 'full'));
