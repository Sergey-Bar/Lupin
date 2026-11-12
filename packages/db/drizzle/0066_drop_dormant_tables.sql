-- Plan task 15 — drop the fourteen dormant tables (ledger C-6).
--
-- `docs/quality/capability-justification.md` recorded these tables as dormant, and a search
-- of `apps/`, `packages/`, `tools/`, `tests/` and `scripts/` found nothing that reads or
-- writes them outside the schema, its shape tests and the legacy importer:
--
--   suites                      test suite hierarchy
--   attachments                 legacy per-result attachments
--   known_failures              known-failure registry
--   nl_query_history            NL->SQL query history
--   failure_taxonomy_rules      rule-based failure classifier config
--   failure_classifications     per-run failure classifications
--   locator_suggestions         self-healing locator suggestions
--   roles                       RBAC roles
--   agent_sessions              AI agent code-review sessions
--   agent_session_runs          agent session <-> run links
--   agent_session_files         files modified in an agent session
--   generated_test_suggestions  AI-generated test drafts
--   repair_attempts             auto-repair attempt records
--   agent_conflicts             concurrent agent conflict detection
--
-- ## What else named them
--
-- One kept table carried a foreign key onto a dropped one:
--
--   tests.suite_id -> suites.id  (0000)
--
-- The key is dropped first. The column and its values stay, as a record of which legacy
-- suite a test came from. Every other key onto a dropped table is held by another dropped
-- table, so the tables are dropped children before parents, and `CASCADE` is deliberately
-- not used: a dependant nobody found makes the migration fail loudly instead of being
-- removed silently.
--
-- ## Data
--
-- A migration must not delete data by default. If any of the fourteen tables holds a row
-- the migration raises, naming each such table and its row count, and applies nothing. The
-- operator who has reviewed those rows opts in for the session:
--
--     SET lupin.allow_drop_nonempty = 'on';
--
-- and an empty table (every install that never used the table) needs no setting.

-- Step 1 — refuse to drop a table that holds rows, unless the operator said so.
DO $$
DECLARE
  target text;
  held integer;
  found text := '';
  allowed boolean;
BEGIN
  allowed := lower(btrim(coalesce(current_setting('lupin.allow_drop_nonempty', true), ''))) = 'on';
  FOREACH target IN ARRAY ARRAY[
    'suites', 'attachments', 'known_failures', 'nl_query_history', 'failure_taxonomy_rules',
    'failure_classifications', 'locator_suggestions', 'roles', 'agent_sessions',
    'agent_session_runs', 'agent_session_files', 'generated_test_suggestions',
    'repair_attempts', 'agent_conflicts'
  ] LOOP
    IF to_regclass(format('public.%I', target)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I', target) INTO held;
    IF held > 0 THEN
      found := found || format('%s%s: %s row(s)', CASE WHEN found = '' THEN '' ELSE ', ' END, target, held);
    END IF;
  END LOOP;
  IF found <> '' AND NOT allowed THEN
    RAISE EXCEPTION
      'Refusing to drop dormant tables that hold rows (%). Review the rows, then run '
      'SET lupin.allow_drop_nonempty = ''on'' in the migrating session to drop them anyway.',
      found;
  END IF;
END
$$;
--> statement-breakpoint

-- Step 2 — the one key a kept table held onto a dropped one. Column and values are kept.
ALTER TABLE "tests" DROP CONSTRAINT IF EXISTS "tests_suite_id_suites_id_fk";
--> statement-breakpoint

-- Step 3 — the tables, children before parents. No CASCADE.
DROP TABLE IF EXISTS "agent_session_runs";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_session_files";
--> statement-breakpoint
DROP TABLE IF EXISTS "generated_test_suggestions";
--> statement-breakpoint
DROP TABLE IF EXISTS "repair_attempts";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_sessions";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_conflicts";
--> statement-breakpoint
DROP TABLE IF EXISTS "failure_classifications";
--> statement-breakpoint
DROP TABLE IF EXISTS "failure_taxonomy_rules";
--> statement-breakpoint
DROP TABLE IF EXISTS "locator_suggestions";
--> statement-breakpoint
DROP TABLE IF EXISTS "nl_query_history";
--> statement-breakpoint
DROP TABLE IF EXISTS "known_failures";
--> statement-breakpoint
DROP TABLE IF EXISTS "attachments";
--> statement-breakpoint
DROP TABLE IF EXISTS "suites";
--> statement-breakpoint
DROP TABLE IF EXISTS "roles";
