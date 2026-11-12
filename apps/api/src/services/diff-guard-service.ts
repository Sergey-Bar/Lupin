import { and, desc, eq, notInArray } from 'drizzle-orm';
import { testTamperReports } from '@lupin/db';
import {
  TEST_TAMPER_KINDS,
  type DiffGuardReport,
  type DiffGuardStatus,
  type DiffGuardUpload,
  type TestTamperKind,
} from '@lupin/shared-contracts';
import { projectRow, type HealthStoreOptions } from './health-findings.js';

/**
 * What `lupin diff-guard` sent for a commit: stored, read back, and read as the change-risk
 * model's tampering input.
 *
 * The CLI reads the diff in the job and sends kinds, paths and line numbers; this module never
 * sees a line of source and has nowhere to put one. A commit with no report reads as `none` —
 * "test changes were not checked" — which the risk model treats as missing evidence, never as
 * a clean report.
 */

export type DiffGuardOptions = HealthStoreOptions & {
  now?: () => Date;
  /** Reports kept per project. Default {@link TAMPER_REPORTS_RETENTION}. */
  retention?: number;
};

/** Reports kept per project; the least recently reported go first. */
export const TAMPER_REPORTS_RETENTION = 5000;

const scopeOf = (options: DiffGuardOptions, projectId: string) =>
  and(
    eq(testTamperReports.workspaceId, options.workspaceId),
    eq(testTamperReports.projectId, projectId),
  );

/** Upsert the commit's report and keep the project's most recent ones. */
export async function recordDiffGuard(
  options: DiffGuardOptions,
  projectId: string,
  upload: DiffGuardUpload,
): Promise<void> {
  const project = await projectRow(options, projectId);
  const values = {
    base: upload.base,
    branch: upload.branch ?? null,
    prNumber: upload.pullRequest ?? null,
    version: upload.report.version,
    counts: upload.report.counts,
    findings: upload.report.findings,
    filesChecked: upload.report.filesChecked,
    truncated: upload.report.truncated,
    reportedAt: options.now?.() ?? new Date(),
  };
  await options.db
    .insert(testTamperReports)
    .values({
      workspaceId: options.workspaceId,
      projectId: project.id,
      commitSha: upload.commit.toLowerCase(),
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        testTamperReports.workspaceId,
        testTamperReports.projectId,
        testTamperReports.commitSha,
      ],
      set: values,
    });
  const scope = scopeOf(options, project.id);
  const keep = options.db
    .select({ id: testTamperReports.id })
    .from(testTamperReports)
    .where(scope)
    .orderBy(desc(testTamperReports.reportedAt), desc(testTamperReports.id))
    .limit(options.retention ?? TAMPER_REPORTS_RETENTION);
  await options.db
    .delete(testTamperReports)
    .where(and(scope, notInArray(testTamperReports.id, keep)));
}

async function reportRow(options: DiffGuardOptions, projectId: string, commit: string) {
  const project = await projectRow(options, projectId);
  const [row] = await options.db
    .select()
    .from(testTamperReports)
    .where(and(scopeOf(options, project.id), eq(testTamperReports.commitSha, commit.toLowerCase())))
    .limit(1);
  return row;
}

/** Only the kinds this version knows: a stored row is read back as the contract describes it. */
const isKind = (kind: string): kind is TestTamperKind =>
  (TEST_TAMPER_KINDS as readonly string[]).includes(kind);

function reportOf(row: NonNullable<Awaited<ReturnType<typeof reportRow>>>): DiffGuardReport {
  const counts: DiffGuardReport['counts'] = {};
  for (const [kind, value] of Object.entries(row.counts)) if (isKind(kind)) counts[kind] = value;
  return {
    version: row.version,
    findings: row.findings.flatMap((finding) =>
      isKind(finding.kind)
        ? [
            {
              kind: finding.kind,
              path: finding.path,
              line: finding.line,
              side: finding.side === 'base' ? 'base' : 'head',
            },
          ]
        : [],
    ),
    counts,
    filesChecked: row.filesChecked,
    truncated: row.truncated,
  };
}

export async function diffGuardStatus(
  options: DiffGuardOptions,
  projectId: string,
  commit: string,
): Promise<DiffGuardStatus> {
  const row = await reportRow(options, projectId, commit);
  if (row === undefined) return { state: 'none', commit: commit.toLowerCase() };
  return {
    state: 'reported',
    commit: row.commitSha,
    base: row.base,
    branch: row.branch,
    pullRequest: row.prNumber,
    report: reportOf(row),
    reportedAt: row.reportedAt.toISOString(),
  };
}

/**
 * The change-risk model's tampering input: every finding counted (not only the ones kept),
 * and the kinds in the contract's order. `null` when no report was sent, which the model
 * reads as "not checked".
 */
export async function tamperForRisk(
  options: DiffGuardOptions,
  projectId: string,
  commit: string,
): Promise<{ findings: number; kinds: TestTamperKind[] } | null> {
  const row = await reportRow(options, projectId, commit);
  if (row === undefined) return null;
  const { counts } = reportOf(row);
  const kinds = TEST_TAMPER_KINDS.filter((kind) => (counts[kind] ?? 0) > 0);
  return { findings: kinds.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0), kinds };
}
