import { and, asc, eq, gte, or } from 'drizzle-orm';
import { qualityGateConfig, scanSnapshots } from '@lupin/db';
import type { RepoScan, ScanSnapshot } from '@lupin/shared-contracts';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * The project's readings over time: coverage, health score, maturity and flaky tests.
 *
 * ## Written on scan, at most once an hour
 *
 * The primary key is `(workspace, project, hour)` and the write is an upsert, so a rescan
 * inside the hour replaces that hour's reading and a busy afternoon of rescans is still one
 * point. The hour is computed here and not by the database because PGlite and PostgreSQL
 * must agree on it, and `date_trunc` against a session time zone would not.
 *
 * ## Every read names the workspace first
 *
 * `scan_snapshots.workspace_id` is `NOT NULL` from its first migration, and every query
 * here filters on it before the project — a project id from another workspace finds
 * nothing rather than another tenant's history.
 */
type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;

const HOUR_MS = 3_600_000;

export function hourOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * Line coverage over every coverage report the scan read, or `null` with none. Weighed by lines
 * when every report carries its counts (lcov, an Istanbul summary with totals), so a ten-line
 * package does not count as much as a thousand-line one; the plain mean otherwise (REL-16).
 */
export function meanCoverage(scan: Pick<RepoScan, 'reports'>): number | null {
  const reports = scan.reports
    .filter((report) => report.kind === 'coverage')
    .filter((report) => {
      const value = report.metrics['lines'];
      return typeof value === 'number' && value >= 0 && value <= 100;
    });
  if (reports.length === 0) return null;
  const counted = reports.map((report) => ({
    found: report.metrics['linesFound'],
    hit: report.metrics['linesHit'],
  }));
  const found = counted.reduce((sum, item) => sum + (item.found ?? 0), 0);
  const weighed =
    found > 0 && counted.every((item) => item.found !== undefined && item.hit !== undefined);
  const value = weighed
    ? (counted.reduce((sum, item) => sum + (item.hit ?? 0), 0) / found) * 100
    : reports.reduce((sum, report) => sum + (report.metrics['lines'] ?? 0), 0) / reports.length;
  return Math.round(value * 10) / 10;
}
export async function hasSnapshotFor(
  options: Options,
  projectId: string,
  at: Date,
): Promise<boolean> {
  const rows = await options.db
    .select({ hour: scanSnapshots.hour })
    .from(scanSnapshots)
    .where(
      and(
        eq(scanSnapshots.workspaceId, options.workspaceId),
        eq(scanSnapshots.projectId, projectId),
        eq(scanSnapshots.hour, hourOf(at)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function recordSnapshot(
  options: Options,
  projectId: string,
  reading: Omit<ScanSnapshot, 'at'>,
  at: Date,
): Promise<void> {
  const values = {
    workspaceId: options.workspaceId,
    projectId,
    hour: hourOf(at),
    takenAt: at,
    coverage: reading.coverage,
    healthScore: reading.healthScore,
    maturity: reading.maturity,
    flakyTests: reading.flakyTests,
  };
  await options.db
    .insert(scanSnapshots)
    .values(values)
    .onConflictDoUpdate({
      target: [scanSnapshots.workspaceId, scanSnapshots.projectId, scanSnapshots.hour],
      set: {
        takenAt: values.takenAt,
        coverage: values.coverage,
        healthScore: values.healthScore,
        maturity: values.maturity,
        flakyTests: values.flakyTests,
      },
    });
}

export async function readHistory(
  options: Options,
  projectId: string,
  since: Date,
): Promise<{ points: ScanSnapshot[]; collectingSince: string | null }> {
  const scope = and(
    eq(scanSnapshots.workspaceId, options.workspaceId),
    eq(scanSnapshots.projectId, projectId),
  );
  const rows = await options.db
    .select()
    .from(scanSnapshots)
    .where(and(scope, gte(scanSnapshots.takenAt, since)))
    .orderBy(asc(scanSnapshots.takenAt));
  const first = await options.db
    .select({ takenAt: scanSnapshots.takenAt })
    .from(scanSnapshots)
    .where(scope)
    .orderBy(asc(scanSnapshots.takenAt))
    .limit(1);
  return {
    points: rows.map((row) => ({
      at: row.takenAt.toISOString(),
      coverage: row.coverage,
      healthScore: row.healthScore,
      maturity: row.maturity,
      flakyTests: row.flakyTests,
    })),
    collectingSince: first[0]?.takenAt.toISOString() ?? null,
  };
}

/** The release pass-rate threshold when the project and the workspace declare none. */
export const DEFAULT_RELEASE_PASS_RATE = 95;

/**
 * The project's own gate threshold, else the workspace default gate's, else the installation
 * default gate's (`global`, shared by design), else 95%. The installation default was not read,
 * so editing it on Settings → Quality gates changed nothing (ledger MNT-203).
 */
export async function passRateThreshold(options: Options, projectId: string): Promise<number> {
  const rows = await options.db
    .select({
      id: qualityGateConfig.id,
      workspaceId: qualityGateConfig.workspaceId,
      projectId: qualityGateConfig.projectId,
      threshold: qualityGateConfig.passRateThreshold,
    })
    .from(qualityGateConfig)
    .where(
      or(
        eq(qualityGateConfig.workspaceId, options.workspaceId),
        eq(qualityGateConfig.id, DEFAULT_GATE_ROW),
      ),
    );
  const mine = rows.filter((row) => row.workspaceId === options.workspaceId);
  const own = mine.find((row) => row.projectId === projectId);
  const workspace = mine.find((row) => row.projectId === null);
  const installation = rows.find((row) => row.id === DEFAULT_GATE_ROW && row.workspaceId === null);
  return (
    own?.threshold ?? workspace?.threshold ?? installation?.threshold ?? DEFAULT_RELEASE_PASS_RATE
  );
}

/** The installation-wide default gate's id (`DEFAULT_GATE_ID` in the dashboard module). */
const DEFAULT_GATE_ROW = 'global';
