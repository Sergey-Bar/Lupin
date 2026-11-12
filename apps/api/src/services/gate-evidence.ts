/**
 * Reads the evidence the gate's security, accessibility and performance domains are decided
 * from, for a run's own commit (plan task 16). `execution/evidence-domains.ts` decides.
 *
 * - SARIF and axe are health reports: the commit's latest report of each format for the run's
 *   project, and the findings still open on it.
 * - ZAP and k6 arrive through the reporter door as runs of their own, so they are the other runs
 *   of the workspace on the same commit whose test ids are `zap.*` and `threshold:*`/`k6.*`.
 *
 * A run with no commit has no evidence of its own, so every domain stays `not_configured`.
 */
import { and, desc, eq, inArray, like, ne, or } from 'drizzle-orm';
import { healthFindings, healthReports, runs, tests } from '@lupin/db';
import {
  evidenceDomains,
  type DomainEvidence,
  type Severity,
} from '../execution/evidence-domains.js';
import type { DomainName, DomainStatus, ExecutionRun, QualityPolicy } from '../execution/types.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

type Db = ProjectRegistryServiceOptions['db'];

async function latestReportFindings(
  db: Db,
  run: Pick<ExecutionRun, 'workspaceId' | 'projectId' | 'commit'>,
  format: string,
): Promise<Severity[] | undefined> {
  if (run.projectId === null || run.commit === null) return undefined;
  const [report] = await db
    .select({ id: healthReports.id })
    .from(healthReports)
    .where(
      and(
        eq(healthReports.workspaceId, run.workspaceId),
        eq(healthReports.projectId, run.projectId),
        eq(healthReports.commitSha, run.commit),
        eq(healthReports.format, format),
      ),
    )
    .orderBy(desc(healthReports.sequence))
    .limit(1);
  if (report === undefined) return undefined;
  const rows = await db
    .select({ severity: healthFindings.severity })
    .from(healthFindings)
    .where(
      and(
        eq(healthFindings.workspaceId, run.workspaceId),
        eq(healthFindings.lastReportId, report.id),
        eq(healthFindings.state, 'open'),
      ),
    );
  return rows.map((row) => row.severity as Severity);
}

/** The other runs on the commit, with the status of every test whose id matches `prefixes`. */
async function commitTests(
  db: Db,
  run: Pick<ExecutionRun, 'id' | 'workspaceId' | 'commit'>,
  prefixes: readonly string[],
): Promise<Map<string, string[]>> {
  const byRun = new Map<string, string[]>();
  if (run.commit === null) return byRun;
  const siblings = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, run.workspaceId),
        ne(runs.id, run.id),
        or(eq(runs.commit, run.commit), eq(runs.commitSha, run.commit)),
      ),
    );
  if (siblings.length === 0) return byRun;
  const rows = await db
    .select({ runId: tests.runId, status: tests.status })
    .from(tests)
    .where(
      and(
        eq(tests.workspaceId, run.workspaceId),
        inArray(
          tests.runId,
          siblings.map((sibling) => sibling.id),
        ),
        or(...prefixes.map((prefix) => like(tests.id, `${prefix}%`))),
      ),
    );
  for (const row of rows) byRun.set(row.runId, [...(byRun.get(row.runId) ?? []), row.status]);
  return byRun;
}

export async function readDomainEvidence(
  db: Db,
  run: Pick<ExecutionRun, 'id' | 'workspaceId' | 'projectId' | 'commit'>,
): Promise<DomainEvidence> {
  const evidence: DomainEvidence = {};
  const sarif = await latestReportFindings(db, run, 'sarif');
  if (sarif !== undefined) evidence.sarif = sarif;
  const axe = await latestReportFindings(db, run, 'axe-json');
  if (axe !== undefined) evidence.axe = axe;
  const zap = await commitTests(db, run, ['zap.']);
  if (zap.size > 0) {
    evidence.zap = [...zap.values()].map((statuses) => ({ failed: statuses.includes('failed') }));
  }
  const k6 = await commitTests(db, run, ['threshold:', 'k6.']);
  if (k6.size > 0) {
    evidence.k6 = [...k6.values()]
      .flat()
      .map((status) =>
        status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'unknown',
      );
  }
  return evidence;
}

/** The evidence-backed domains for a run under a policy; absent ones stay `not_configured`. */
export async function evidenceDomainsFor(
  db: Db,
  run: Pick<ExecutionRun, 'id' | 'workspaceId' | 'projectId' | 'commit'>,
  policy: Pick<QualityPolicy, 'rules'>,
): Promise<Partial<Record<DomainName, DomainStatus>>> {
  return evidenceDomains(await readDomainEvidence(db, run), policy);
}
