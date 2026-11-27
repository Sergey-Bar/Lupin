import type { Hono } from 'hono';
import { selfChecks } from '@lupin/reporting';
import { SelfChecksSchema } from '@lupin/shared-contracts';
import { readSince } from '../../execution/trend.js';
import { operatorSnapshot } from '../../observability/operator-metrics.js';
import type { ExecutionRouteContext } from './shared.js';

const WEEK_MS = 7 * 86_400_000;

/**
 * `GET /api/v1/self-checks`: what this install noticed about itself (plan 1795712849115 task
 * 16). It gathers; `selfChecks` in `@lupin/reporting` decides.
 *
 * The facts are the run store (the newest result, the week's runs and whether a gate judged
 * them, the queued jobs) and what this process observed (runner heartbeats, connector calls).
 * Backups are not a fact the API can see, since the start scripts write them on the host, so
 * that check is left to `start doctor` rather than guessed here.
 */
export function registerSelfCheckRoutes(app: Hono, context: ExecutionRouteContext): void {
  const { options, ws } = context;
  app.get('/api/v1/self-checks', async (c) => {
    const now = new Date();
    const [{ runs: newest }, jobs, week] = await Promise.all([
      options.store.listRuns(ws, undefined, { limit: 1 }),
      options.store.listJobs(ws),
      readSince(options.store, ws, now.getTime() - WEEK_MS),
    ]);
    const observed = operatorSnapshot();
    const lastRun = newest[0]?.createdAt ?? null;
    const lastResultAt =
      [lastRun, observed.lastReporterEventAt]
        .filter((at): at is string => at !== null)
        .sort()
        .at(-1) ?? null;
    const items = selfChecks({
      now,
      lastResultAt,
      lastHeartbeatAt: observed.lastHeartbeatAt,
      queuedJobs: jobs.filter((job) => job.state === 'queued' || job.state === 'requeued').length,
      connectors: observed.connectors,
      recentRuns: {
        total: week.runs.length,
        gated: week.runs.filter(
          (run) => run.policyEvaluation !== null && run.policyEvaluation !== undefined,
        ).length,
      },
    });
    return c.json(SelfChecksSchema.parse({ evaluatedAt: now.toISOString(), items }));
  });
}
