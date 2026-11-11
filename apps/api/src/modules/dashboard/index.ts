/**
 * index.ts — Dashboard Hono sub-app
 *
 * Combines all dashboard route modules under a single Hono instance.
 * Mount in apps/api/src/index.ts via: app.route('/', createDashboardModule({ repository }))
 */
import { Hono } from 'hono';
import type { RunRepository } from '../../repositories/run-repository.js';
import type { QuarantineStore } from './quarantine.js';
import type { AuditSink } from './audit-sink.js';
import type { DashboardQualityGatesOptions, QualityGateStore } from './quality-gates.js';
import { createDashboardRunsRoutes } from './runs.js';
import { createDashboardTestsRoutes } from './tests.js';
import { createTestHistoryRoutes } from './test-history.js';
import { createDashboardAnalyticsRoutes } from './analytics.js';
import { createDashboardQuarantineRoutes, InMemoryQuarantineStore } from './quarantine.js';
import { createDashboardQualityGatesRoutes, InMemoryQualityGateStore } from './quality-gates.js';

// ---------------------------------------------------------------------------
// Module options
// ---------------------------------------------------------------------------

export interface DashboardModuleOptions {
  /**
   * Shared run repository — must be the same instance used by the reporter
   * and runs routes so dashboard reads reflect ingested data immediately.
   */
  repository: RunRepository;
  /** Optional quarantine store (for production DB-backed wiring or tests) */
  quarantineStore?: QuarantineStore;
  /** Optional quality gate store (for production DB-backed wiring or tests) */
  qualityGateStore?: QualityGateStore;
  /** Where the run status change is recorded (ledger MNT-171). */
  audit: AuditSink;
  /**
   * The routes' two questions about the caller: who they are, for the audit row, and
   * whether they may change what every workspace shares.
   */
  caller: Pick<DashboardQualityGatesOptions, 'mayChangeInstallation'> & {
    contextFor: NonNullable<DashboardQualityGatesOptions['contextFor']>;
  };
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createDashboardModule(options: DashboardModuleOptions): Hono {
  const app = new Hono();

  // Shared in-memory stores (per-process lifetime, temporary until Postgres layer)
  const quarantineStore = options.quarantineStore ?? new InMemoryQuarantineStore();
  const qualityGateStore = options.qualityGateStore ?? new InMemoryQualityGateStore();

  app.route(
    '/',
    createDashboardRunsRoutes({
      repository: options.repository,
      audit: options.audit,
      contextFor: options.caller.contextFor,
    }),
  );
  // Before the test list, so `/tests/history` is not read as a test id.
  app.route('/', createTestHistoryRoutes({ repository: options.repository }));
  app.route('/', createDashboardTestsRoutes({ repository: options.repository }));
  app.route('/', createDashboardAnalyticsRoutes({ repository: options.repository }));
  app.route(
    '/',
    createDashboardQuarantineRoutes({
      store: quarantineStore,
      // Approving one takes a test out of the pass rate: the trail names who did it (MNT-171).
      contextFor: options.caller.contextFor,
    }),
  );
  app.route('/', createDashboardQualityGatesRoutes({ store: qualityGateStore, ...options.caller }));

  return app;
}

// Re-export store types so callers can inject custom stores for testing
export type { QuarantineStore } from './quarantine.js';
export type { QualityGateStore } from './quality-gates.js';
export { InMemoryQuarantineStore } from './quarantine.js';
export { InMemoryQualityGateStore } from './quality-gates.js';
