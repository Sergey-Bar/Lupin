-- Health snapshots become traceable and comparable (cockpit, Task 1). Additive only.
--
-- `commit_sha` is the commit of the `health_reports` row that triggered the snapshot, copied by
-- the writer from that row and from no other source. It is null when the report named no
-- commit, and for a snapshot a person caused (a triage, a policy change), because no commit
-- changed that grade. Rows from before this migration stay null: the cockpit says "unknown".
--
-- `formula_version` is `GRADE_FORMULA_VERSION` (`packages/projects/src/health/grade.ts`) when
-- the grade was computed. The default 0 marks every earlier row as unversioned, so a trend never
-- compares a point from before the version existed with a versioned one: a change of formula
-- would read as a change in the product.
--
-- `scan_snapshots` is deliberately unchanged. It keeps one row per hour, and an hour can hold
-- several commits, so a single commit would be a guess.

ALTER TABLE "health_snapshots" ADD COLUMN IF NOT EXISTS "commit_sha" text;
--> statement-breakpoint
ALTER TABLE "health_snapshots" ADD COLUMN IF NOT EXISTS "formula_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "health_snapshots"
  ADD CONSTRAINT "health_snapshots_formula_version_check" CHECK ("formula_version" >= 0);
