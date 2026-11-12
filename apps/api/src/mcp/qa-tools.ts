/**
 * The QA read tools (plan task 24): runs, a test's history, quarantine, failure causes, a pull
 * request's change risk and release sign-offs. Read-only, like every tool on this server, and
 * bound to the caller's workspace through `scope.health`; a pinned caller reads its project only.
 * Every list is capped, so no tool can return a workspace's whole history.
 */
import { and, desc, eq, or, isNull } from 'drizzle-orm';
import { z } from 'zod/v4';
import { quarantine, runs, tests } from '@lupin/db';
import { PullRequestRiskHistorySchema, ReleaseSignoffListSchema } from '@lupin/shared-contracts';
import { pullRequestRisk } from '../services/change-risk-service.js';
import { readStoredClusters } from '../services/failure-cluster-store.js';
import { listSignoffs } from '../services/release-signoff-service.js';
import { allowed, type McpScope, type McpTool } from './tools.js';

const ProjectId = z.string().uuid().describe('The project id, from list_projects.');
const Limit = (fallback: number, max: number) =>
  z
    .number()
    .int()
    .min(1)
    .max(max)
    .default(fallback)
    .describe(`At most ${String(max)}.`);

/** The project a list reads: the caller's pin when there is one, else the one asked for. */
function projectScope(scope: McpScope, projectId: string | undefined): string | undefined {
  if (projectId !== undefined) return allowed(scope, projectId);
  return scope.pinned ?? undefined;
}

const RunRowSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  outcome: z.string().nullable(),
  phase: z.string(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  createdAt: z.string(),
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  flaky: z.number().int(),
});

const listRuns: McpTool = {
  name: 'list_runs',
  title: 'List runs',
  description:
    'Recent runs, newest first, with outcome, branch, commit and test counts. One project, or every project the token can read.',
  input: { projectId: ProjectId.optional(), limit: Limit(20, 100) },
  run: async (scope, args) => {
    const parsed = z.object({ projectId: ProjectId.optional(), limit: Limit(20, 100) }).parse(args);
    const project = projectScope(scope, parsed.projectId);
    const rows = await scope.health.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.workspaceId, scope.health.workspaceId),
          ...(project === undefined ? [] : [eq(runs.projectId, project)]),
        ),
      )
      .orderBy(desc(runs.createdAt))
      .limit(parsed.limit);
    const value = z.object({ runs: z.array(RunRowSchema) }).parse({
      runs: rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        outcome: row.outcome,
        phase: row.phase,
        branch: row.branch,
        commit: row.commitSha ?? row.commit,
        createdAt: row.createdAt.toISOString(),
        total: row.total,
        passed: row.passed,
        failed: row.failed,
        flaky: row.flaky,
      })),
    });
    const failed = value.runs.filter((run) => run.outcome === 'failed').length;
    return { summary: `${String(value.runs.length)} run(s), ${String(failed)} failed.`, value };
  },
};

const TestHistorySchema = z.object({
  stableId: z.string(),
  observations: z.array(
    z.object({ runId: z.string(), status: z.string(), durationMs: z.number().nullable() }),
  ),
  failed: z.number().int(),
  flaky: z.number().int(),
  /** Times the status changed between consecutive observations, oldest first. */
  flips: z.number().int(),
});

const getTestHistory: McpTool = {
  name: 'get_test_history',
  title: 'Test history',
  description:
    "One test's recent results, newest first, and how often it failed, was flaky or flipped. The test is named by its stable id (file › title, with the project).",
  input: {
    stableId: z.string().min(1).max(1000),
    projectId: ProjectId.optional(),
    limit: Limit(30, 200),
  },
  run: async (scope, args) => {
    const parsed = z
      .object({
        stableId: z.string().min(1).max(1000),
        projectId: ProjectId.optional(),
        limit: Limit(30, 200),
      })
      .parse(args);
    const project = projectScope(scope, parsed.projectId);
    const rows = await scope.health.db
      .select({
        runId: tests.runId,
        status: tests.status,
        durationMs: tests.durationMs,
        projectId: runs.projectId,
      })
      .from(tests)
      .innerJoin(runs, eq(runs.id, tests.runId))
      .where(
        and(
          eq(tests.workspaceId, scope.health.workspaceId),
          eq(tests.stableId, parsed.stableId),
          ...(project === undefined ? [] : [eq(runs.projectId, project)]),
        ),
      )
      .orderBy(desc(runs.createdAt))
      .limit(parsed.limit);
    const oldestFirst = [...rows].reverse();
    const flips = oldestFirst.filter(
      (row, index) => index > 0 && row.status !== oldestFirst[index - 1]?.status,
    ).length;
    const value = TestHistorySchema.parse({
      stableId: parsed.stableId,
      observations: rows.map((row) => ({
        runId: row.runId,
        status: row.status,
        durationMs: row.durationMs,
      })),
      failed: rows.filter((row) => row.status === 'failed').length,
      flaky: rows.filter((row) => row.status === 'flaky').length,
      flips,
    });
    return {
      summary: `${String(rows.length)} result(s): ${String(value.failed)} failed, ${String(value.flaky)} flaky, ${String(flips)} flip(s).`,
      value,
    };
  },
};

const QuarantineRowSchema = z.object({
  id: z.string(),
  testTitle: z.string(),
  testFile: z.string(),
  stableId: z.string().nullable(),
  status: z.string(),
  reason: z.string().nullable(),
  quarantinedAt: z.string(),
  projectId: z.string().nullable(),
});

const listQuarantine: McpTool = {
  name: 'list_quarantine',
  title: 'Quarantine',
  description:
    'Quarantined tests with their status: pending ones still count in the pass rate, approved ones are excused until released.',
  input: { projectId: ProjectId.optional(), limit: Limit(50, 200) },
  run: async (scope, args) => {
    const parsed = z.object({ projectId: ProjectId.optional(), limit: Limit(50, 200) }).parse(args);
    const project = projectScope(scope, parsed.projectId);
    const rows = await scope.health.db
      .select()
      .from(quarantine)
      .where(
        and(
          eq(quarantine.workspaceId, scope.health.workspaceId),
          // An entry with no project matches the test in every project, so it is shown too.
          ...(project === undefined
            ? []
            : [or(eq(quarantine.projectId, project), isNull(quarantine.projectId))]),
        ),
      )
      .orderBy(desc(quarantine.quarantinedAt))
      .limit(parsed.limit);
    const value = z.object({ entries: z.array(QuarantineRowSchema) }).parse({
      entries: rows.map((row) => ({
        id: row.id,
        testTitle: row.testTitle,
        testFile: row.testFile,
        stableId: row.stableId,
        status: row.status,
        reason: row.reason,
        quarantinedAt: row.quarantinedAt.toISOString(),
        projectId: row.projectId,
      })),
    });
    const pending = value.entries.filter((entry) => entry.status === 'pending').length;
    return {
      summary: `${String(value.entries.length)} entr${value.entries.length === 1 ? 'y' : 'ies'}, ${String(pending)} pending.`,
      value,
    };
  },
};

const ClusterSchema = z.object({
  signature: z.string(),
  errorType: z.string().nullable(),
  sampleMessage: z.string(),
  count: z.number().int(),
  tests: z.array(z.string()),
  branches: z.array(z.string()),
  runs: z.number().int(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});

const listFailureCauses: McpTool = {
  name: 'list_failure_causes',
  title: 'Failure causes',
  description:
    'The root causes failures cluster into over the stored history (the last 90 days), most frequent first, with first and last seen. Empty until the cluster job has run once.',
  input: { projectId: ProjectId.optional(), limit: Limit(20, 100) },
  run: async (scope, args) => {
    const parsed = z.object({ projectId: ProjectId.optional(), limit: Limit(20, 100) }).parse(args);
    const project = projectScope(scope, parsed.projectId) ?? '';
    const stored = await readStoredClusters(
      scope.health.db as never,
      scope.health.workspaceId,
      project,
      parsed.limit,
    );
    const value = z
      .object({
        computed: z.boolean(),
        clusters: z.array(ClusterSchema),
        totals: z.object({ failures: z.number().int(), causes: z.number().int() }),
      })
      .parse({
        computed: stored !== null,
        clusters: stored?.clusters ?? [],
        totals: stored?.totals ?? { failures: 0, causes: 0 },
      });
    return {
      summary:
        stored === null
          ? 'No causes stored yet: the cluster job has not run for this scope.'
          : `${String(value.totals.failures)} failure(s) in ${String(value.totals.causes)} cause(s).`,
      value,
    };
  },
};

const getChangeRisk: McpTool = {
  name: 'get_change_risk',
  title: 'Change risk',
  description:
    "A pull request's change risk: the level, the score and every factor that adds to it, for its latest head and the heads before it.",
  input: { projectId: ProjectId, pullRequest: z.number().int().min(1) },
  run: async (scope, args) => {
    const parsed = z
      .object({ projectId: ProjectId, pullRequest: z.number().int().min(1) })
      .parse(args);
    const value = PullRequestRiskHistorySchema.parse(
      await pullRequestRisk(
        scope.health as never,
        allowed(scope, parsed.projectId),
        parsed.pullRequest,
      ),
    );
    const latest = value.latest;
    return {
      summary:
        latest === null
          ? `Pull request #${String(parsed.pullRequest)} has no risk assessment yet.`
          : `Pull request #${String(parsed.pullRequest)}: ${latest.risk.level} risk, ${String(latest.risk.score)} point(s), over ${String(value.history.length)} head(s).`,
      value,
    };
  },
};

const listSignoffsTool: McpTool = {
  name: 'list_signoffs',
  title: 'Release sign-offs',
  description:
    'Ship and hold decisions for a project, newest first: the commit, the verdict each was made against, the reason, and whether it overrode a no-go.',
  input: { projectId: ProjectId },
  run: async (scope, args) => {
    const parsed = z.object({ projectId: ProjectId }).parse(args);
    const value = ReleaseSignoffListSchema.parse({
      signoffs: await listSignoffs(scope.health as never, allowed(scope, parsed.projectId)),
    });
    const latest = value.signoffs[0];
    return {
      summary:
        latest === undefined
          ? 'Nobody has signed off a release of this project.'
          : `Latest: ${latest.decision} on ${latest.commit} against ${latest.verdict}${latest.override ? ' (override)' : ''}.`,
      value,
    };
  },
};

export const QA_READ_TOOLS: readonly McpTool[] = [
  listRuns,
  getTestHistory,
  listQuarantine,
  listFailureCauses,
  getChangeRisk,
  listSignoffsTool,
];
