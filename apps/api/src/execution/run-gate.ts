import { createGateEvaluation, defaultPolicy } from './quality-gate.js';
import type {
  DomainName,
  DomainStatus,
  ExecutionRun,
  ExecutionStore,
  GateEvaluation,
} from './types.js';

/**
 * The quality gate's verdict on one run: the recorded evaluation when the run's completion
 * wrote one, otherwise the evaluation it would receive, computed and **not** persisted
 * (`recorded: false`). Recording is the completion path's job.
 *
 * This is the one reading of a run's gate. `GET /api/v1/runs/:id/gate` answers with it and the
 * release-readiness card reads it, so the run page and Home cannot give one run two verdicts.
 * Before it existed the card read `run.policyEvaluation`, which the PostgreSQL store never
 * populates, and Home said no gate had evaluated anything on every real install (ledger REL-2).
 */
export async function runGate(
  store: ExecutionStore,
  workspaceId: string,
  run: ExecutionRun,
): Promise<(GateEvaluation & { recorded: boolean }) | null> {
  const recorded = await store.getRunGate(workspaceId, run.id);
  if (recorded) return { ...recorded, recorded: true };
  const policy = run.policyId
    ? await store.getPolicy(run.policyId, workspaceId)
    : ((await store.listPolicies(workspaceId))[0] ??
      (await store.createPolicy(defaultPolicy(workspaceId))));
  if (!policy) return null;
  const evaluation = createGateEvaluation({
    run,
    policy,
    domainStatuses: {
      ...((await store.evidenceDomains?.(run, policy)) ?? {}),
      ...domainStatusesFromRun(run),
    },
    evaluatedAt: run.completedAt ?? undefined,
    quarantined: await store.quarantined(workspaceId),
  });
  return { ...evaluation, recorded: false };
}

/** The gate of the newest run in `runs` that has finished, or `null` when none has. */
export async function latestGate(
  store: ExecutionStore,
  workspaceId: string,
  runs: readonly ExecutionRun[],
): Promise<{ status: GateEvaluation['status']; runId: string } | null> {
  const newest = runs
    .filter((run) => run.outcome !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (newest === undefined) return null;
  const gate = await runGate(store, workspaceId, newest);
  return gate === null ? null : { status: gate.status, runId: newest.id };
}

/** What the gate is told about the browser domain, from the run's own outcome. */
export function domainStatusesFromRun(
  run: ExecutionRun,
): Partial<Record<DomainName, DomainStatus>> {
  if (run.outcome === 'passed') return { browser: 'passed' };
  if (run.outcome === 'failed') return { browser: 'failed' };
  if (run.outcome === 'partial') return { browser: 'warning' };
  return { browser: 'unknown' };
}
