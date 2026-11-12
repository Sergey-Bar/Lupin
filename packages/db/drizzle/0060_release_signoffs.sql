CREATE TABLE "release_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"decision" text NOT NULL,
	"verdict" text NOT NULL,
	"override" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_signoffs_decision_check" CHECK ("release_signoffs"."decision" IN ('ship', 'hold')),
	CONSTRAINT "release_signoffs_verdict_check" CHECK ("release_signoffs"."verdict" IN ('go', 'caution', 'no-go')),
	CONSTRAINT "release_signoffs_override_check" CHECK ("release_signoffs"."override" = ("release_signoffs"."decision" = 'ship' AND "release_signoffs"."verdict" = 'no-go'))
);
--> statement-breakpoint
ALTER TABLE "release_signoffs" ADD CONSTRAINT "release_signoffs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_signoffs" ADD CONSTRAINT "release_signoffs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_signoffs_project_idx" ON "release_signoffs" USING btree ("workspace_id","project_id","created_at");