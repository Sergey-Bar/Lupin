import { createHash } from 'node:crypto';

export interface SourceTable {
  name: string;
  rowCount: number;
  columns: string[];
}

export interface MigrationPlan {
  planVersion: 1;
  toolVersion: string;
  sourceId: string;
  sourceCommit: string;
  targetCommit: string;
  catalogFingerprint: string;
  tables: Array<
    SourceTable & { disposition: 'migrate' | 'retain-dormant' | 'blocked'; reason?: string }
  >;
  artifacts: { digest: string; count: number };
  vault: { envelopeVersion: number; keyReference: string; count: number };
}

const blockedSourceTables = new Set(['users', 'saml_config', 'saml_configs', 'sp_private_key']);
const dormantSourceTables = new Set([
  'predictions',
  'alerts',
  'alert_rules',
  'generation_endpoints',
  'generation_sessions',
]);

const DROPPED_DORMANT = 'Dropped by 0066 (ledger C-6): no reader or writer';

/**
 * Source tables with no target since `0030_drop_superseded_tables` (ledger MNT-60) and
 * `0066_drop_dormant_tables` (ledger C-6).
 *
 * A legacy file may still hold rows in them. They are not imported, because there is no
 * table to write them to, and the plan and the import report say so rather than leaving
 * a clean-looking result over rows that were discarded. The source file is read-only to
 * the importer, so nothing is lost: the rows stay in the SQLite file.
 */
export const SUPERSEDED_SOURCE_TABLES: Readonly<Record<string, string>> = {
  results: 'Superseded by canonical_run_results; per-retry rows are not imported',
  blob_shards: 'Superseded by runs.read_at; sharded blob tracking is not imported',
  api_keys: 'Superseded by the installation key; hashed personal keys are never imported',
  // Dropped by `0066_drop_dormant_tables` (ledger C-6, plan task 15).
  suites: DROPPED_DORMANT,
  attachments: DROPPED_DORMANT,
  known_failures: DROPPED_DORMANT,
  nl_query_history: DROPPED_DORMANT,
  failure_taxonomy_rules: DROPPED_DORMANT,
  failure_classifications: DROPPED_DORMANT,
  locator_suggestions: DROPPED_DORMANT,
  roles: DROPPED_DORMANT,
  agent_sessions: DROPPED_DORMANT,
  agent_session_runs: DROPPED_DORMANT,
  agent_session_files: DROPPED_DORMANT,
  generated_test_suggestions: DROPPED_DORMANT,
  repair_attempts: DROPPED_DORMANT,
  agent_conflicts: DROPPED_DORMANT,
};

export function buildPlan(input: {
  sourceId: string;
  sourceCommit: string;
  targetCommit: string;
  toolVersion: string;
  tables: SourceTable[];
  artifactDigest?: string;
  artifactCount?: number;
  vaultEnvelopeVersion?: number;
  vaultKeyReference?: string;
  vaultCount?: number;
}): MigrationPlan {
  const catalogFingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        input.tables.map(({ name, columns }) => ({ name, columns: [...columns].sort() })),
      ),
    )
    .digest('hex');
  return {
    planVersion: 1,
    toolVersion: input.toolVersion,
    sourceId: input.sourceId,
    sourceCommit: input.sourceCommit,
    targetCommit: input.targetCommit,
    catalogFingerprint,
    tables: input.tables.map((table) => ({
      ...table,
      disposition: blockedSourceTables.has(table.name)
        ? 'blocked'
        : dormantSourceTables.has(table.name) || table.name in SUPERSEDED_SOURCE_TABLES
          ? 'retain-dormant'
          : 'migrate',
      reason: blockedSourceTables.has(table.name)
        ? 'Requires an approved security/identity transformation'
        : table.name in SUPERSEDED_SOURCE_TABLES
          ? SUPERSEDED_SOURCE_TABLES[table.name]
          : dormantSourceTables.has(table.name)
            ? 'Retained as dormant compatibility data'
            : undefined,
    })),
    artifacts: { digest: input.artifactDigest ?? '0'.repeat(64), count: input.artifactCount ?? 0 },
    vault: {
      envelopeVersion: input.vaultEnvelopeVersion ?? 1,
      keyReference: input.vaultKeyReference ?? 'unconfigured',
      count: input.vaultCount ?? 0,
    },
  };
}
