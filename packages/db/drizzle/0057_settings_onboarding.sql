-- Settings an admin saves from the interface, and per-workspace onboarding progress.
--
--   `installation_settings`  one row per registry key (`SETTINGS` in @lupin/shared-contracts).
--                            Global: an AI gateway or a sign-in provider belongs to the
--                            installation. No secret is stored here; a secret is a vault entry
--                            under `setting:<key>` and the row holds only `{sealed, last4}`.
--   `onboarding_progress`    which setup steps a workspace skipped, and the checklist dismissal.
--                            Hard-scoped from its first migration: `workspace_id` NOT NULL, a
--                            `restrict` key onto `workspaces`, and an index leading with it.
--
-- Additive only, and safe to apply twice.

CREATE TABLE IF NOT EXISTS "installation_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_progress" (
  "workspace_id" text NOT NULL,
  "step" text NOT NULL,
  "state" text NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_progress_workspace_id_step_pk" PRIMARY KEY ("workspace_id", "step")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_progress_workspace_idx" ON "onboarding_progress" USING btree ("workspace_id");
