// Loaded first, for its side effects: it reads `.env` into `process.env` and initialises the
// error reporter before any module below evaluates `process.env` or throws from a config or
// startup-policy check. An ES import is hoisted and runs in source order, so this line is the
// in-code equivalent of the `--import ./dist/instrument.js` preload the container used — and it
// works identically under `tsx` in dev, where the forwarded `--import` flag did not register the
// TypeScript loader for the preloaded module (tsx 4.23.x) and so could not resolve its imports.
import './instrument.js';
import {
  recordClientAddress,
  requestContext,
  requireRequestId,
} from './observability/request-context.js';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { createErrorBoundary } from './errors/boundary.js';
import { withClassifiedErrors } from './errors/db-errors.js';
import { createHealthRoutes } from './routes/health.js';
import {
  createCloudflareAccessVerifier,
  createCloudflareCallerSource,
} from './http/cloudflare-access.js';
import { createCloudflarePeople } from './http/cloudflare-people.js';
import { perRequest } from './http/per-request.js';
import { createReporterRoutes } from './routes/reporter.js';
import { createAuthRoutes, defaultClientKey } from './routes/auth.js';
import { createOidcRoutes } from './routes/oidc.js';
import { callerForUser } from './services/user-service.js';
import { isLoopbackBind, parseCloudflareRoleMap, type OidcConfig } from '@lupin/config';
import {
  browserCredentialsCount,
  callerOf,
  isInstallationAdmin,
  type CallerResolver,
} from './http/roles.js';
import {
  createWorkspaceDispatch,
  resolveRequestWorkspace,
  type WorkspaceLookups,
} from './http/workspace-dispatch.js';
import { createDatabaseWorkspaceLookups } from './http/workspace-lookups.js';
import { createWorkspacesRoutes } from './routes/workspaces.js';
import { applyRouteAccess } from './http/route-access.js';
import { secureCookiePolicy, type SecureCookies } from './http/secure-cookies.js';
import { createClientAllowlist } from './middleware/client-allowlist.js';
import { createOriginCheck } from './middleware/origin-check.js';
import { hashCredential } from '@lupin/auth';
import { createReporterResultsRoute } from './routes/reporter-results.js';
import { createReportingRoutes } from './routes/reporting.js';
import { createRunnerRoutes } from './routes/runner.js';
import { createOrchestrationRoutes } from './routes/orchestration.js';
import { ReporterIngestionService } from './services/reporter-ingestion.js';
import type { ReporterResultStore } from './services/reporter-ingestion.js';
import { DrizzleReporterIngestionService } from './services/drizzle-reporter-ingestion.js';
import { DrizzleAuthSessionBackend } from './infrastructure/session-backend.js';
import {
  NO_INSTALLATION_KEY,
  bootstrapDisplayPrefix,
  mayDeriveInstallationKey,
} from './bootstrap-display-prefix.js';
import { RunnerControlService } from './services/runner-control.js';
import { OrchestrationService } from './services/orchestration-service.js';
import { createEventsRoutes } from './routes/events.js';
import { createExecutionRoutes } from './routes/execution.js';
import { createAnalyticsTrendRoutes, readSince } from './execution/trend.js';
import { createInsightsRoutes } from './execution/insights.js';
import { createAgentRoutes } from './routes/agents.js';
import { createAgentCatalog } from './routes/agent-registry.js';
import { createToolRegistry } from '@lupin/tool-sdk';
import { registerApiAgent } from './agents/api-adapter.js';
import { registerBrowserAgent } from './agents/browser-adapter.js';
import { registerLoadAgent } from './agents/load-adapter.js';
import { createChatRoutes } from './routes/chat.js';
import { createCopilotRoutes } from './copilot/routes.js';
import { createLiveAiGateway } from './observability/live-ai-gateway.js';
import { createSettingsService } from './services/settings-service.js';
import { createSettingTesters } from './services/settings-testers.js';
import { createSettingsRoutes } from './routes/settings.js';
import {
  createIdentitySettingsRoutes,
  currentIdentity,
  installationAdminGuard,
} from './routes/identity-settings.js';
import {
  createIdentityDrafts,
  fingerprint,
  oidcConfigFrom,
  roleUnderDraft,
} from './services/identity-settings.js';
import { InMemoryExecutionStore } from './execution/in-memory-execution-store.js';
import { DrizzleExecutionStore } from './execution/drizzle-execution-store.js';
import type { ExecutionStore } from './execution/types.js';
// Development/test repository — replaced by DrizzleRunRepository when DATABASE_URL is set.
// Production deployments require DATABASE_URL per startup policy.
// Post-MVP: Remove InMemoryRunRepository fallback entirely (issue #TBD).
import { InMemoryRunRepository } from './repositories/in-memory-run-repository.js';
import { DrizzleRunRepository } from './repositories/drizzle-run-repository.js';
import {
  createDbResources,
  DrizzleInstallationKeyStore,
  DrizzleSessionStore,
  workspaces,
} from '@lupin/db';
import { ingestScanArtifact } from './services/repo-health-service.js';
import { poolCapabilities } from './services/runner-pool.js';
import { readGitToken } from './services/git-credential-service.js';
import { rotateVaultSecrets } from './services/vault-secrets.js';
import { audit, authenticateToken } from './services/access-service.js';
import { alertsFor, deliverAlerts, useGitHubApi } from './services/health-integrations.js';
import type { ReportEvent } from './services/repo-health-service.js';
import { createGitHubAdapter } from '@lupin/connectors-github';
import { jiraAdapter } from '@lupin/connectors-jira';
import { slackAdapter } from '@lupin/connectors-slack';
import { signalAdapter } from '@lupin/connectors-signal';
import { emailAdapter } from '@lupin/connectors-email';
import { teamsAdapter } from '@lupin/connectors-teams';
import { telegramAdapter } from '@lupin/connectors-telegram';
import { whatsappAdapter } from '@lupin/connectors-whatsapp';
import { createReportDispatcher } from './services/report-dispatcher.js';
import { createDeliverySyncer } from './services/delivery-syncer.js';
import { getCookie } from 'hono/cookie';
import { DEFAULT_IGNORED, fileSystemView } from '@lupin/projects';
import { createRepoScanner } from './services/repo-scan-service.js';
import { createProjectsRoutes } from './routes/projects.js';
import {
  discoverProjectAtBoot,
  ensureWorkspace,
  type ProjectRegistryServiceOptions,
} from './services/project-registry-service.js';
import { DEFAULT_WORKSPACE_ID, type RunRepository } from './repositories/run-repository.js';
// Realtime transport: durable outbox-backed bus in production, in-memory for
// development/test. Post-MVP: Add WebSocket transport (issue #TBD).
import { InMemoryRealtimeBus } from './realtime/realtime-bus.js';
import type { RealtimeBus } from './realtime/realtime-bus.js';
import { DurableRealtimeBus } from './realtime/durable-realtime-bus.js';
import { DrizzleRealtimeFeed } from './infrastructure/drizzle-realtime-feed.js';
import { startOutboxRetentionSweep } from './infrastructure/outbox-retention.js';
import type { AiGateway } from '@lupin/automation';
import {
  pruneExpiredSpansEverywhere,
  SELF_AGENT_NAME,
  selfInstrumented,
  TEST_PROPOSAL_AGENT_NAME,
} from './services/genai-span-service.js';
import { Lifecycle, closeHttpServer, installShutdownHandlers } from './bootstrap/lifecycle.js';
// T18: dashboard module — runs detail, tests listing, analytics, quarantine, quality gates
import { createDashboardModule } from './modules/dashboard/index.js';
import { InMemoryQuarantineStore, type QuarantineStore } from './modules/dashboard/quarantine.js';
import { boundQuarantineSource } from './execution/quarantine-excusal.js';
import { commitTests } from './services/commit-tests.js';
import { publicLink } from './services/public-link.js';
import { applyProjectQuarantinePolicy } from './services/quarantine-policy-service.js';
import { listTriageLabels } from './services/triage-label-service.js';
import type { ExecutionRun } from './execution/types.js';
import {
  DrizzleQuarantineStore,
  DrizzleQualityGateStore,
} from './modules/dashboard/drizzle-stores.js';
// No auth middleware: the install is open. See the note where it used to be mounted,
// and ADR-006 for the posture. The session and key routes stay mounted — they mint
// nothing anybody is required to hold.
import { createRequestDeadline } from './middleware/request-deadline.js';
import { createSecurityHeaders } from './middleware/security-headers.js';
import { getConfig } from './config.js';
import { createSentryErrorReporter } from './observability/sentry.js';
import { createLogger } from './observability/logger.js';
import {
  createOtlpExporter,
  otlpRequestSpans,
  readOtlpSettings,
} from './observability/otlp-traces.js';
import {
  assertInMemoryAllowed,
  checkExposurePolicy,
  checkProductionPolicy,
  exposureWarning,
  identityWarning,
  resolveAuthSecrets,
} from './startup-policy.js';
import {
  FallbackArtifactBytesStore,
  LocalArtifactBytesStore,
  LocalArtifactStore,
} from './infrastructure/artifact-store.js';
import { S3ArtifactBytesStore } from './infrastructure/s3-artifact-bytes.js';
import type { ArtifactBytesStore } from './execution/drizzle-execution-store.js';

const runtimeConfig = getConfig();
// GitHub.com unless GITHUB_API_URL (or Settings → Integrations) names a GitHub Enterprise
// Server; a bad environment URL stops boot. Delegating, so a saved address swaps the adapter
// in place and every holder of `githubAdapter` follows it.
let githubInner = createGitHubAdapter(
  runtimeConfig.githubApiUrl === undefined ? {} : { apiBase: runtimeConfig.githubApiUrl },
);
const githubAdapter: typeof githubInner = {
  manifest: githubInner.manifest,
  execute: (request, secret) => githubInner.execute(request, secret),
};
useGitHubApi(runtimeConfig.githubApiUrl);
/**
 * Session lifetimes, in milliseconds, read from configuration.
 *
 * Both were literal `24 * 60 * 60 * 1000` in this file while
 * `packages/config` declared `SESSION_TTL_HOURS` and `SESSION_RETENTION_DAYS` and
 * mapped them onto this config. So the literals and the settings agreed only because
 * the defaults happened to be the same number — an operator who set
 * `SESSION_TTL_HOURS=8` got eight hours in nothing. The fallbacks below are the
 * schema's own defaults, so the value is unchanged for a default deployment and
 * *does* follow the setting when there is one.
 */
// Read live from the settings service below (`liveSessionTtlMs`, `liveSessionRetentionMs`),
// with these same configuration values as the fallback.
// Production policy is validated before any composition: no database client, no
// in-memory fallback, and no secret literal is constructed before this point.
checkProductionPolicy(runtimeConfig);
checkExposurePolicy(runtimeConfig);
const { cookieSecret: authCookieSecret, installationKey: installationKey } =
  resolveAuthSecrets(runtimeConfig);

const installationId = '00000000-0000-4000-8000-000000000001';
const databaseUrl = runtimeConfig.databaseUrl;
/**
 * One pool for the process. Every repository, store, feed and health probe
 * below shares `databaseResources.db`. Constructing a client per component
 * created five `pg.Pool` instances — 40–50 sockets for a single
 * `DATABASE_URL` — and exhausting them was a matter of traffic, not scale.
 */
const databaseResources = databaseUrl ? createDbResources(databaseUrl) : undefined;

/**
 * The installation's settings: environment first, then what an admin saved from Settings,
 * then the default. One instance for the process, so a save invalidates the one cache every
 * consumer reads. Secret settings are sealed in the home workspace's vault.
 */
const settingsService = createSettingsService({
  ...(databaseResources === undefined ? {} : { db: databaseResources.db as never }),
  workspaceId: runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID,
  vaultSecret: runtimeConfig.vaultSecret,
  env: process.env,
});
/**
 * Runs a settings refresh without awaiting it, and logs a failure instead of letting it become
 * an unhandled rejection: an API that cannot read its settings at boot (no database yet) keeps
 * serving with the environment and defaults. The log sink is read when the failure arrives,
 * after the module has finished composing.
 */
function inBackground(task: Promise<unknown>, what: string): void {
  task.catch((error: unknown) => {
    try {
      logger.warn(`could not ${what}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Boot was refused before the log sink existed; the refusal is the error that matters.
    }
  });
}

/** A setting as a number, for the consumers that need one synchronously. Refreshed on save. */
const numericSettings = new Map<string, number>();
async function refreshNumeric(key: string): Promise<void> {
  const value = await settingsService.resolve(key);
  if (typeof value === 'number') numericSettings.set(key, value);
}
for (const key of ['sessions.ttlHours', 'retention.sessionDays', 'retention.sseReplayHours']) {
  inBackground(refreshNumeric(key), 'read a session setting');
}
async function followGitHubApi(): Promise<void> {
  const url = await settingsService.resolve('integrations.githubApiUrl');
  const apiUrl = typeof url === 'string' && url !== '' ? url : undefined;
  githubInner = createGitHubAdapter(apiUrl === undefined ? {} : { apiBase: apiUrl });
  useGitHubApi(apiUrl);
}
inBackground(followGitHubApi(), 'read the GitHub API address');
settingsService.subscribe((key) => {
  inBackground(refreshNumeric(key), 'refresh a numeric setting');
  if (key === 'integrations.githubApiUrl')
    inBackground(followGitHubApi(), 'read the GitHub API address');
  if (key.startsWith('identity.')) inBackground(refreshIdentity(), 'refresh sign-in');
});

/**
 * Sign-in, as Settings → Identity (or the environment) says now. Read synchronously by the
 * caller resolver, the auth routes and the features probe, so it is a snapshot refreshed on
 * every identity save rather than a lookup per request.
 */
const identityDrafts = createIdentityDrafts();
const installationPublicUrl = runtimeConfig.publicAppUrl ?? 'http://localhost:5173';
let liveOidc: OidcConfig | undefined = runtimeConfig.oidc;
let liveSsoEnforced = runtimeConfig.ssoEnforced === true;
async function refreshIdentity(): Promise<void> {
  const values = await currentIdentity(settingsService);
  try {
    liveOidc = oidcConfigFrom(values, installationPublicUrl);
  } catch (error) {
    // A saved value that no longer builds (it was valid when applied): sign-in is off until
    // fixed, and the log says why, rather than a half-configured provider.
    liveOidc = undefined;
    logger.warn('single sign-on is off: the saved configuration is incomplete', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // Explicit (environment or saved) wins; otherwise the profile's own default stands — the
  // enterprise profile turns single sign-on on without AUTH_SSO_ENFORCED being set.
  const sso = await settingsService.read('identity.ssoEnforced');
  liveSsoEnforced =
    sso.source === 'environment' || sso.source === 'ui'
      ? values['identity.ssoEnforced'] === true
      : runtimeConfig.ssoEnforced === true;
}
inBackground(refreshIdentity(), 'read sign-in settings');

/**
 * How a save on one API instance reaches the others: every instance re-reads the saved
 * settings on this interval and tells its subscribers which keys moved, so a revoked role or a
 * newly enforced sign-in applies everywhere within the interval, not at the next restart.
 */
const SETTINGS_POLL_MS = 15_000;
const settingsPoll =
  databaseResources === undefined
    ? undefined
    : setInterval(
        () => inBackground(settingsService.refresh(), 'refresh saved settings'),
        SETTINGS_POLL_MS,
      );
settingsPoll?.unref();
const HOUR_MS = 60 * 60 * 1000;
const liveSessionTtlMs = () =>
  (numericSettings.get('sessions.ttlHours') ?? runtimeConfig.sessionTtlHours ?? 24) * HOUR_MS;
const liveSessionRetentionMs = () =>
  (numericSettings.get('retention.sessionDays') ?? runtimeConfig.sessionRetentionDays ?? 30) *
  24 *
  HOUR_MS;

function createRunRepository(workspaceId: string): RunRepository {
  if (databaseResources) {
    return new DrizzleRunRepository(databaseResources.db, workspaceId);
  }
  // Development/test fallback — startup policy enforces DATABASE_URL in production.
  assertInMemoryAllowed(runtimeConfig, 'InMemoryRunRepository');
  return new InMemoryRunRepository();
}

function createDashboardStores(workspaceId: string): {
  quarantineStore: QuarantineStore;
  qualityGateStore?: DrizzleQualityGateStore;
} {
  if (!databaseResources) {
    assertInMemoryAllowed(runtimeConfig, 'dashboard stores');
    // Created here rather than inside the dashboard module, so the gate and the dashboard
    // read one quarantine.
    return { quarantineStore: new InMemoryQuarantineStore() };
  }
  // Bound to the workspace being composed, as every other store is. Both used to be composed
  // with none: `quarantine` had no column to scope by, and every audit row they wrote
  // carried a NULL workspace (ledger MNT-17).
  return {
    quarantineStore: new DrizzleQuarantineStore(databaseResources.db, workspaceId),
    qualityGateStore: new DrizzleQualityGateStore(databaseResources.db, workspaceId),
  };
}

const app = new Hono();

/**
 * The process's one log sink.
 *
 * Created here, at the composition root, and injected downward. Anywhere else it
 * would be a second sink — and two sinks means two formats, so a deployment
 * reading the log has to know which of them produced the line it is looking at.
 */
const logger = createLogger({ service: 'lupin-api' });
const unknownExposure = exposureWarning(runtimeConfig);
if (unknownExposure !== undefined) logger.warn(unknownExposure);
const openIdentity = identityWarning(runtimeConfig);
if (openIdentity !== undefined) logger.warn(openIdentity);
/**
 * The API's own request traces to the operator's OTLP collector (ADR-014, enterprise). Off
 * unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; a wrong setting is logged and leaves it off
 * rather than refusing to start, because a telemetry sink must not take the API down.
 */
const otlpRead = readOtlpSettings();
if (otlpRead !== undefined && 'problem' in otlpRead) {
  logger.warn('OTLP trace export is off', { problem: otlpRead.problem });
}
const otlpExporter =
  otlpRead !== undefined && 'settings' in otlpRead
    ? createOtlpExporter(otlpRead.settings, { warn: (message) => logger.warn(message) })
    : undefined;

/**
 * The one model provider decision, made **per call** from the settings in effect, so a
 * provider saved from Settings → AI applies without a restart. `observability/live-ai-gateway.ts`
 * re-resolves only when the configuration changed.
 *
 * Unconfigured is a gateway that refuses with a coded 503, not a missing one: an
 * optional feature that is switched off should not be a deployment that will not
 * start, and a client deserves a claim it can act on rather than a `null` the
 * route has to guess about.
 */
const liveAi = createLiveAiGateway(settingsService);
const settingTesters = createSettingTesters();
const aiGateway = liveAi.gateway;
inBackground(
  liveAi.provider().then((provider) => {
    if (provider === null) {
      // Named at startup, because "chat 404s with a permission error" is a much longer
      // diagnosis than "no model provider is configured".
      logger.warn('chat is unconfigured and will refuse requests until a provider is saved', {
        fix: 'Settings → AI provider',
      });
    } else {
      logger.info('chat provider selected', { provider });
    }
  }),
  'read the AI provider',
);

/**
 * Self-instrumentation: with a database, every chat completion is recorded as one GenAI
 * `chat` span — model, tokens, duration, outcome; never content — with no project
 * (`source = 'self'`, agent `lupin-chat`), read by `GET /api/v1/chat/runtime`. A test
 * proposal asks the same provider, instrumented the same way, under the agent name
 * `lupin-test-proposals` so the runtime page tells them from chat. Each resolved provider is
 * decorated with its own name, so a span records the provider that actually answered.
 *
 * **Built per workspace** (ADR-014), so a workspace's spans are written in that workspace,
 * where its runtime page reads them. Unconfigured, both refuse each request with the reason.
 */
function selfGateways(workspaceId: string): { chat: AiGateway; testProposals: AiGateway | null } {
  if (databaseResources === undefined) return { chat: aiGateway, testProposals: aiGateway };
  const spans = { db: databaseResources.db as never, workspaceId };
  const instrumented = (agent: string, what: string) =>
    createLiveAiGateway(settingsService, {
      decorate: (gateway, provider) =>
        selfInstrumented(spans, gateway, provider, agent, (error) =>
          logger.warn(`${what} span could not be recorded`, { error: String(error) }),
        ),
    }).gateway;
  return {
    chat: instrumented(SELF_AGENT_NAME, 'chat'),
    testProposals: instrumented(TEST_PROPOSAL_AGENT_NAME, 'test proposal'),
  };
}

/**
 * One error boundary for the whole app.
 *
 * Without it, Hono's default handler produced a bare 500 for anything a handler
 * threw, so a Postgres CHECK violation — a state transition the schema rejects —
 * was indistinguishable from a defect, and a serialization failure (which is
 * retryable) was indistinguishable from either. Every response now carries a
 * stable `code`; see `apps/api/src/errors/`.
 */
const errorBoundary = createErrorBoundary({
  // From the request context, not from the header: six sites re-derived this
  // independently with different fallbacks — some generated a UUID, one stored
  // `null`, one stored `'unknown'` — so one execution could not be traced by one id
  // from the log line to the event row. See `observability/request-context.ts`
  // (ledger O-1b).
  requestId: () => requireRequestId(),
  // The boundary is the only place that knows whether a throw was a defect or a
  // refusal, so it is also the only place that decides what gets reported.
  reportError: createSentryErrorReporter(),
  // The seam was declared, documented as injectable, and passed by nothing —
  // so every failure in the API reached a `console.error(message, context)`:
  // a message string and a loose object side by side, unparseable and
  // unqueryable. Nothing could have caught it, because every test supplies its
  // own collector and the test path was therefore always populated while the
  // production path never was. `observability/logger.ts` is the one sink.
  log: logger.error,
});
app.onError(errorBoundary.onError);
app.notFound(errorBoundary.notFound);

// Shared run repository — lives for the lifetime of the process.
// createRunRepository() selects DrizzleRunRepository when DATABASE_URL is set,
// falling back to InMemoryRunRepository for development/test.
//
// Wrapped in `withClassifiedErrors` so no store method can leak a raw `pg` error:
// a CHECK, unique or FK violation arrives as a `DomainError` with a code and a
// mapped status, for the HTTP route and for the worker's reaper alike. Wrapping
// method by method is what misses the ones nobody remembers, and a missed one
// surfaces as a bare 500 that a caller then retries forever.
const artifactStore = new LocalArtifactStore(
  runtimeConfig.artifactRoot ?? process.env['ARTIFACT_ROOT'] ?? '.artifacts',
);

// Artifact bytes go to the configured S3-compatible object store whenever one is
// configured, which production policy requires. The local filesystem store stays
// the development/test convenience; assertInMemoryAllowed keeps a bypassed
// policy gate from silently composing process-local evidence in production.
function createArtifactBytesStore(): ArtifactBytesStore {
  if (runtimeConfig.objectStore) {
    const primary = new S3ArtifactBytesStore(runtimeConfig.objectStore);
    const fallbackRoot = runtimeConfig.artifactReadFallbackRoot;
    if (!fallbackRoot) return primary;
    return new FallbackArtifactBytesStore(
      primary,
      new LocalArtifactBytesStore(new LocalArtifactStore(fallbackRoot)),
    );
  }
  assertInMemoryAllowed(runtimeConfig, 'LocalArtifactBytesStore');
  return new LocalArtifactBytesStore(artifactStore);
}

const artifactBytesStore = createArtifactBytesStore();

function createExecutionStore(
  workspaceId: string,
  quarantineFor: ReturnType<typeof boundQuarantineSource>,
): ExecutionStore {
  if (databaseResources) {
    return new DrizzleExecutionStore({
      db: databaseResources.db,
      workspaceId,
      artifactBytes: artifactBytesStore,
      quarantined: quarantineFor,
    });
  }
  assertInMemoryAllowed(runtimeConfig, 'InMemoryExecutionStore');
  return new InMemoryExecutionStore({ quarantined: quarantineFor });
}

/**
 * The one canonical store both reporting and the reporter doors resolve.
 *
 * **Two instances would be two ingestion systems again.** `mountReportingRoutes` used to
 * build its own, and the reporter routes had none — so an upload could land in the
 * installation and `/api/v1/reporting/kpis` answered `proofCeiling: 'unknown'` about a
 * system with a year of test history (ledger row P-73). The store is now built here, once,
 * and handed to both.
 */
function mountLegacyProcessLocalRoutes(target: Hono): void {
  if (runtimeConfig.nodeEnv === 'production') {
    const disabled = new Hono();
    const body = {
      status: 'unavailable',
      implemented: false,
      code: 'PROCESS_LOCAL_CONTROL_DISABLED',
      message: 'Legacy process-local control routes are disabled in production',
    };
    disabled.all('/runner/v1', (context) => context.json(body, 503));
    disabled.all('/runner/v1/*', (context) => context.json(body, 503));
    for (const path of [
      '/api/v1/automations',
      '/api/v1/automations/*',
      '/api/v1/schedules',
      '/api/v1/jobs',
      '/api/v1/jobs/*',
    ]) {
      disabled.all(path, (context) => context.json(body, 503));
    }
    target.route('/', disabled);
    return;
  }
  target.route('/', createRunnerRoutes(new RunnerControlService()));
  target.route('/', createOrchestrationRoutes(new OrchestrationService()));
}
// Durable outbox-backed realtime in production; process-local events otherwise. One feed serves
// every workspace; each composition has its own bus, which stamps its workspace on what it writes.
const realtimeFeed = databaseResources ? new DrizzleRealtimeFeed(databaseResources.db) : undefined;
const retentionSweep = realtimeFeed ? startOutboxRetentionSweep(realtimeFeed) : undefined;
/**
 * GenAI span retention, hourly, through the same sweep the outbox uses — in every workspace,
 * one at a time. Spans are also pruned on every OTLP write; this is what removes a project's
 * last window after it stops exporting.
 */
const spanRetentionSweep = databaseResources
  ? startOutboxRetentionSweep(
      { purgeExpired: (now) => pruneExpiredSpansEverywhere(databaseResources.db as never, now) },
      3_600_000,
      (error) => logger.warn('genai span retention sweep failed', { error: String(error) }),
    )
  : undefined;
/**
 * Sends the scheduled reports the worker queues. Only with a database, because the queue
 * and the channel credentials both live there; started below with the server, and stopped
 * before the pool so no send is cut off mid-query.
 */
const reportDispatcher = databaseResources
  ? createReportDispatcher({
      db: databaseResources.db as never,
      vaultSecret: runtimeConfig.vaultSecret,
      adapters: {
        slack: slackAdapter,
        teams: teamsAdapter,
        telegram: telegramAdapter,
        whatsapp: whatsappAdapter,
        signal: signalAdapter,
        email: emailAdapter,
      },
      link: publicLink(runtimeConfig.publicAppUrl, '/dashboard/now'),
    })
  : undefined;
/**
 * Runs the delivery syncs the worker, an operator or a webhook queues: GitHub reads with the
 * project's vault-held token, which is why this lives here and not in the worker. Started and
 * stopped beside the report dispatcher.
 */
const deliverySyncer = databaseResources
  ? createDeliverySyncer({
      db: databaseResources.db as never,
      vaultSecret: runtimeConfig.vaultSecret,
      adapter: githubAdapter,
      log: (message, details) => logger.info(message, details),
    })
  : undefined;
// Declared rather than inferred from the branches. It infers
// `DrizzleAuthSessionBackend | undefined` today, which is why `noImplicitAny`
// passes — but a `let` with no annotation is one refactor away from being one, and
// `undefined` is the meaningful half of that union, not an afterthought.
let sessionBackend: DrizzleAuthSessionBackend | undefined;
if (databaseResources) {
  sessionBackend = new DrizzleAuthSessionBackend(
    new DrizzleSessionStore(databaseResources.db),
    authCookieSecret,
    liveSessionTtlMs,
    // The retention window, which was parsed and mapped and read by nothing until
    // the sweep had something to sweep with. It is longer than the TTL on purpose:
    // a row outlives its validity so that "was this ever valid" still has an answer.
    liveSessionRetentionMs,
  );
} else {
  // createAuthRoutes falls back to a process-local session store without this.
  assertInMemoryAllowed(runtimeConfig, 'in-memory auth sessions');
}
/**
 * Session retention, hourly: deletes the rows issued before `SESSION_RETENTION_DAYS`. The
 * backend's `sweep` existed and nothing scheduled it, so `sessions` grew with every sign-in
 * for the life of the installation. Any instance may run it: the cutoff is a pure function of
 * the clock, so two instances sweeping the same database remove the same rows.
 */
const sessionRetentionSweep = ((backend) =>
  backend === undefined
    ? undefined
    : startOutboxRetentionSweep(
        { purgeExpired: async () => (await backend.sweep()).removed },
        3_600_000,
        (error) => logger.warn('session retention sweep failed', { error: String(error) }),
      ))(sessionBackend);
// Production never derives one. See `mayDeriveInstallationKey` for why the two
// readings of P-72 were separate rows: renaming the label on a bootstrapped key was
// cosmetic, deriving that key in production is not.
if (
  databaseResources &&
  !mayDeriveInstallationKey(runtimeConfig) &&
  !process.env['LUPIN_INSTALLATION_KEY']
) {
  throw new Error(NO_INSTALLATION_KEY);
}

const installationKeyHash = databaseResources
  ? await new DrizzleInstallationKeyStore(databaseResources.db).ensureConfigured({
      installationId,
      keyHash: hashCredential(authCookieSecret, installationKey),
      displayPrefix: bootstrapDisplayPrefix(runtimeConfig),
    })
  : hashCredential(authCookieSecret, installationKey);
/**
 * Whether session cookies are `Secure`: fixed by `COOKIE_SECURE` or an https public URL,
 * otherwise read per request from the edge's `X-Forwarded-Proto`. See `http/secure-cookies.ts`.
 */
const secureCookies = secureCookiePolicy({
  explicit: process.env['COOKIE_SECURE'],
  publicAppUrl: runtimeConfig.publicAppUrl,
  trustProxy: runtimeConfig.trustProxy,
});
function resolveSecureCookies(): SecureCookies {
  return secureCookies;
}

const authRoutes = createAuthRoutes({
  cookieSecret: authCookieSecret,
  installationId,
  installationKeyHash,
  sessionTtlMs: liveSessionTtlMs,
  secureCookies: resolveSecureCookies(),
  trustProxy: runtimeConfig.trustProxy,
  sessionBackend,
  sso: {
    // Read per request, so requiring single sign-on from Settings ? Identity applies live.
    get enforced() {
      return liveSsoEnforced;
    },
    breakGlass: runtimeConfig.breakGlass === true,
    // Every break-glass sign-in is loud: a warning in the log and a row in the audit trail.
    onBreakGlass: (context) => {
      const client = defaultClientKey(context, runtimeConfig.trustProxy ?? false);
      logger.warn('break-glass sign-in with the installation key', { client });
      if (databaseResources !== undefined) {
        void audit(
          {
            db: databaseResources.db as never,
            workspaceId: runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID,
          },
          {
            actor: 'session',
            action: 'auth.break-glass',
            resourceType: 'installation',
            resourceId: installationId,
            details: { client },
          },
        );
      }
    },
  },
});
if (runtimeConfig.ssoEnforced === true && runtimeConfig.breakGlass === true) {
  logger.warn(
    'LUPIN_BREAK_GLASS is on: the installation key can sign a browser in while single ' +
      'sign-on is enforced. Every use is audited. Turn it off once you are back in.',
  );
}

/**
 * The browser session this request carries, read once per request (`http/per-request.ts`):
 * the dispatch, the person check and the installation check all ask, and each read is a
 * SELECT and a `last_used_at` write on the same row.
 */
const sessionOf = perRequest(async (context: Context) => {
  const token = getCookie(context, 'lupin_session');
  return token === undefined ? undefined : authRoutes.sessions.validate(token);
});

/**
 * Origins allowed to make credentialed cross-origin requests.
 *
 * `PUBLIC_APP_URL` is the web client, which is where almost every install puts
 * its only browser origin. `CORS_ALLOWED_ORIGINS` adds more, for the split
 * deployment where the client is served from a different host.
 *
 * Default-deny rather than a wildcard, because the session cookie is the
 * credential: `*` would be rejected by the browser for a credentialed request
 * anyway, and the workarounds people reach for instead — reflecting the request's
 * origin, or allowing `null` — hand the session to any site the user visits.
 * A same-origin client sends no `Origin` at all and is unaffected.
 */
function resolveAllowedOrigins(): string[] {
  const origins = new Set<string>();
  const publicAppUrl = runtimeConfig.publicAppUrl?.trim();
  if (publicAppUrl !== undefined && publicAppUrl !== '' && publicAppUrl !== 'null') {
    origins.add(new URL(publicAppUrl).origin);
  }
  for (const extra of (process.env['CORS_ALLOWED_ORIGINS'] ?? '').split(',')) {
    const trimmed = extra.trim();
    if (trimmed === '') continue;
    // Normalised through `URL` so `https://a.test:443/` and `https://a.test` are
    // one origin. An unparseable value is dropped rather than passed through: a
    // string that never matches an `Origin` header is a typo that would otherwise
    // look like a working configuration.
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      console.error(`CORS_ALLOWED_ORIGINS: ignoring "${trimmed}", which is not an origin.`);
    }
  }
  return [...origins];
}

/**
 * What every repository-health ingestion shares, whichever door the report came through: a CI
 * upload, a scan the runner ran, or a scheduled scan the worker enqueued. Nothing in it depends
 * on the workspace, so every workspace's composition shares the one copy.
 */
const dashboardUrl = (projectId: string): string =>
  `${(runtimeConfig.publicAppUrl ?? 'http://localhost:5173').replace(/\/$/u, '')}/dashboard/repo/${encodeURIComponent(projectId)}`;
/** Read per report, so a Slack token or signing secret saved from Settings applies to the next one. */
async function healthAlertChannels() {
  const token = await settingsService.resolve('integrations.slackBotToken');
  const secret = await settingsService.resolve('integrations.healthWebhookSecret');
  return {
    slack: typeof token === 'string' && token !== '' ? { adapter: slackAdapter, token } : undefined,
    webhookSecret: typeof secret === 'string' && secret !== '' ? secret : undefined,
  };
}
const healthHooks = {
  readRepositoryFile: async (repoPath: string, path: string) => fileSystemView(repoPath).read(path),
  onReport: async (event: ReportEvent) => {
    const alerts = alertsFor({
      previous: event.previous,
      current: event.current,
      added: event.added,
      onDefaultBranch: event.onDefaultBranch,
    });
    if (alerts.length === 0) return;
    const outcomes = await deliverAlerts(await healthAlertChannels(), event.settings.alerts ?? {}, {
      projectId: event.projectId,
      project: event.project,
      branch: event.branch,
      detailsUrl: dashboardUrl(event.projectId),
      alerts,
    });
    if (outcomes.length > 0)
      logger.info('health alerts delivered', { projectId: event.projectId, outcomes });
  },
};

/** An error's message for a log line, whatever was thrown. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * What every workspace's projects routes share, computed once: the chat provider the eval
 * runner and test proposals report, the installation's own links, the scheduled-report and
 * delivery hooks, and the SCIM default role. None of it depends on the workspace.
 */
// Live: the provider in effect at the moment a run or a proposal starts.
const chatProvider = () => liveAi.provider();
const evalGateway = aiGateway;
const installationUrl = runtimeConfig.publicAppUrl ?? 'http://localhost:8080';
const dispatchNowHook =
  reportDispatcher === undefined ? {} : { dispatchNow: () => reportDispatcher.runOnce() };
const scimDefaultRole =
  runtimeConfig.oidc?.defaultRole == null
    ? {}
    : { scimDefaultRole: runtimeConfig.oidc.defaultRole };
const deliveryHooks = {
  // `lanMode` here means "reachable by GitHub": LAN mode, or a Cloudflare tunnel whose Access
  // application bypasses the receiver's path (ADR-014). The HMAC is the credential.
  lanMode: runtimeConfig.lanMode === true || runtimeConfig.remote === 'cloudflare',
  // Read per request, so a secret saved from Settings → Integrations turns the receiver on.
  webhookSecret: async () => {
    const secret = await settingsService.resolve('integrations.githubWebhookSecret');
    return typeof secret === 'string' && secret !== '' ? secret : undefined;
  },
  ...(deliverySyncer === undefined ? {} : { syncNow: () => deliverySyncer.runOnce() }),
};

/**
 * Cloudflare Access (ADR-014): one verifier for the process, so every workspace shares one key
 * cache. On `team` and `enterprise`, with a database, the people it lets in are accounts — the
 * role map decides their role in the default workspace and memberships the rest, and what SCIM
 * or an admin decides reaches them. On `startup` an identity is read through the role map
 * alone, as that profile has no accounts. A service token is a machine on every profile.
 */
const cloudflareAccess =
  runtimeConfig.remote === 'cloudflare' ? runtimeConfig.cloudflareAccess : undefined;
const cloudflareVerifier =
  cloudflareAccess === undefined ? undefined : createCloudflareAccessVerifier(cloudflareAccess);
/**
 * The Access rules, from Settings → Identity when an installation admin saved them. The
 * caller sources read `roleMap` and `defaultRole` off this object per request, so updating it
 * in place is what makes a saved rule apply without a restart.
 */
async function followCloudflareRules(): Promise<void> {
  if (cloudflareAccess === undefined) return;
  const map = await settingsService.resolve('identity.cfAccessRoleMap');
  const role = await settingsService.resolve('identity.cfAccessDefaultRole');
  try {
    cloudflareAccess.roleMap = parseCloudflareRoleMap(typeof map === 'string' ? map : undefined);
  } catch (error) {
    logger.warn('the saved Cloudflare Access rules do not parse; the previous rules stay', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (role === 'none') cloudflareAccess.defaultRole = null;
  else if (role === 'viewer' || role === 'operator' || role === 'admin') {
    cloudflareAccess.defaultRole = role;
  }
}
inBackground(followCloudflareRules(), 'read Cloudflare Access rules');
settingsService.subscribe((key) => {
  if (key.startsWith('identity.cfAccess'))
    inBackground(followCloudflareRules(), 'read Cloudflare Access rules');
});
const accessLog = (message: string, fields: Record<string, unknown>) =>
  logger.warn(message, fields);
const cloudflarePeople =
  cloudflareAccess !== undefined &&
  cloudflareVerifier !== undefined &&
  databaseResources !== undefined &&
  (runtimeConfig.profile === 'team' || runtimeConfig.profile === 'enterprise')
    ? createCloudflarePeople({
        db: databaseResources.db as never,
        defaultWorkspace: runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID,
        verifier: cloudflareVerifier,
        access: cloudflareAccess,
        log: accessLog,
      })
    : undefined;

/** The remote credential source for one workspace's resolver, when the install has one. */
function remoteCallerSource(
  workspaceId: string,
): Pick<CallerResolver, 'authenticateRemote'> | Record<string, never> {
  if (cloudflarePeople !== undefined) {
    return { authenticateRemote: cloudflarePeople.callerIn(workspaceId) };
  }
  if (cloudflareAccess === undefined || cloudflareVerifier === undefined) return {};
  return {
    authenticateRemote: createCloudflareCallerSource(cloudflareVerifier, cloudflareAccess, {
      log: accessLog,
    }),
  };
}

// First, so every later middleware and every handler — and every error the
// boundary reports — runs with a request id already in scope. A context
// established after the first thing that can fail is a context the first thing
// that can fail does not have (ledger O-1b).
/**
 * One workspace's composition (ADR-014): its stores, its caller resolver, its realtime bus, and
 * a `mount` that registers its route groups. Built once for the default workspace, served in
 * place, and once for each other workspace the first time a request is dispatched to it
 * (`http/workspace-dispatch.ts`). Everything in here is bound to `workspaceId` when it is
 * built, which is the property every isolation test in this API reasons about.
 */
function buildWorkspace(workspaceId: string) {
  // Wrapped in `withClassifiedErrors` so no store method can leak a raw `pg` error.
  const runRepository = withClassifiedErrors(createRunRepository(workspaceId));
  const dashboardStores = createDashboardStores(workspaceId);

  /**
   * The quarantine entries every gate evaluation reads. The dashboard's quarantine store is
   * bound to the workspace being composed, so it answers for that workspace and no other: a run
   * in any other workspace gets no entries, and so no excusal.
   */
  const quarantineFor = boundQuarantineSource(workspaceId, () =>
    dashboardStores.quarantineStore.list(),
  );

  /** The workspace's runs since a moment, oldest first: what the quarantine policy reads. */
  async function workspaceHistory(since: Date): Promise<ExecutionRun[]> {
    const { runs } = await readSince(executionStore, workspaceId, since.getTime());
    return [...runs].sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
    );
  }

  const executionStore = withClassifiedErrors(createExecutionStore(workspaceId, quarantineFor));

  /**
   * The one tool registry the agent routes dispatch through, and the catalog that
   * `/api/v1/features` and `/api/v1/agents` both read availability from. Browser is the first
   * domain with a real adapter: `browser.run` queues a Playwright job through the same store
   * `POST /api/v1/runs` uses, `api.run` queues a Bruno job and `load.run` a bounded k6 job the
   * same way. The other two domains register nothing and answer `501`.
   */
  const agentRegistry = createToolRegistry();
  registerBrowserAgent({
    registry: agentRegistry,
    store: executionStore,
    workspaceId,
    // As `POST /api/v1/runs`: required in production, generated otherwise.
    requireIdempotencyKey: runtimeConfig.nodeEnv === 'production',
  });
  registerApiAgent({
    registry: agentRegistry,
    store: executionStore,
    workspaceId,
    requireIdempotencyKey: runtimeConfig.nodeEnv === 'production',
  });
  registerLoadAgent({
    registry: agentRegistry,
    store: executionStore,
    workspaceId,
    requireIdempotencyKey: runtimeConfig.nodeEnv === 'production',
  });
  const agentCatalog = createAgentCatalog(agentRegistry);
  const gateways = selfGateways(workspaceId);
  let reporterStore: ReporterResultStore | undefined;

  function resolveReporterStore(): ReporterResultStore {
    if (reporterStore) return reporterStore;
    reporterStore = databaseResources
      ? new DrizzleReporterIngestionService(databaseResources.db, workspaceId)
      : new ReporterIngestionService(workspaceId);
    return reporterStore;
  }

  function mountReportingRoutes(target: Hono): void {
    const store = resolveReporterStore();
    target.route(
      '/',
      createReporterResultsRoute(store, {
        reporterSecret: runtimeConfig.reporterSecret,
        requireReporterSecret: runtimeConfig.nodeEnv === 'production',
      }),
    );
    target.route('/', createReportingRoutes(store));
  }

  let realtimeBus: RealtimeBus;
  /** The durable bus, when one was constructed — the readiness probe needs its own view. */
  let durableRealtimeBus: DurableRealtimeBus | undefined;
  if (realtimeFeed) {
    durableRealtimeBus = new DurableRealtimeBus(
      realtimeFeed,
      workspaceId,
      // Read per event, so a replay window saved from Settings applies to the next one.
      () =>
        numericSettings.get('retention.sseReplayHours') ??
        runtimeConfig.sseReplayRetentionHours ??
        24,
    );
    realtimeBus = durableRealtimeBus;
  } else {
    assertInMemoryAllowed(runtimeConfig, 'InMemoryRealtimeBus');
    realtimeBus = new InMemoryRealtimeBus();
  }

  const access: CallerResolver = {
    mode: runtimeConfig.accessControl ?? 'open',
    profile: runtimeConfig.profile ?? 'solo',
    get ssoEnforced() {
      return liveSsoEnforced;
    },
    // Under enforced SSO, the installation key's session and a browser's token cookie count
    // again only with LUPIN_BREAK_GLASS on (`http/roles.ts`).
    breakGlass: runtimeConfig.breakGlass === true,
    // A verified Cloudflare Access identity, only on an install reached through the tunnel
    // (ADR-014). The startup policy has already refused a tunnel without both Access settings.
    ...remoteCallerSource(workspaceId),
    authenticateToken: async (token) =>
      databaseResources === undefined
        ? null
        : authenticateToken(
            {
              db: databaseResources.db as never,
              workspaceId: workspaceId,
            },
            token,
          ),
    // A person's session (ADR-014, team), with their role in this workspace. Only with a
    // database: people are rows in `users`.
    ...(databaseResources === undefined
      ? {}
      : {
          authenticateSession: async (context: Context) => {
            const record = await sessionOf(context);
            if (record?.userId === undefined) return null;
            // A disabled or deleted person's session is nobody, not the installation's.
            return (
              (await callerForUser(
                {
                  db: databaseResources.db as never,
                  workspaceId: workspaceId,
                },
                record.userId,
              )) ?? { actor: 'anonymous', role: null, uploaderFor: null }
            );
          },
        }),
    // The installation's own session only: a person's session is never the admin by default.
    hasSession: async (context) => {
      const record = await sessionOf(context);
      return record !== undefined && record.userId === undefined;
    },
  };

  function mount(target: Hono): void {
    applyRouteAccess(target, access);
    target.route(
      '/',
      createReporterRoutes(runtimeConfig.reporterSecret, {
        repository: runRepository,
        // The same store `GET /api/v1/reporting/kpis` reads. Without it an upload has nowhere
        // canonical to land, and every KPI would report the busiest system in the
        // installation as not knowable.
        canonicalStore: resolveReporterStore(),
        // The same workspace the execution routes resolve for a read. Without it the
        // reporter wrote NULL and every run a producer reported was invisible to
        // `GET /api/v1/runs` — persisted, and absent from the product.
        workspaceId: workspaceId,
        bus: realtimeBus,
        artifactStore: { putAt: (key, bytes) => artifactBytesStore.put(key, bytes) },
        // The live reporter's traces and screenshots, filed as the run's own artifacts.
        artifacts: executionStore,
        allowQueryToken: false,
      }),
    );
    target.route(
      '/',
      createExecutionRoutes({
        store: executionStore,
        legacyRepository: runRepository,
        workspaceId: workspaceId,
        runnerRegistrationSecret: runtimeConfig.runnerRegistrationSecret,
        sharedRunners: true,
        bus: realtimeBus,
        // A health scanner's report is ingested the moment the runner uploads it.
        ...(databaseResources === undefined
          ? {}
          : {
              // A cloned repository's token, read from the vault only for the runner holding the lease.
              checkoutToken: async (run) =>
                run.projectId === null
                  ? null
                  : readGitToken(
                      {
                        db: databaseResources.db as never,
                        workspaceId: workspaceId,
                        vaultSecret: runtimeConfig.vaultSecret,
                      },
                      run.projectId,
                    ),
              onArtifact: async ({ run, name, bytes, metadata }) => {
                try {
                  await ingestScanArtifact(
                    { db: databaseResources.db as never, workspaceId: workspaceId, ...healthHooks },
                    run.configuration,
                    name,
                    bytes,
                    typeof metadata['sourceRoot'] === 'string' ? metadata['sourceRoot'] : undefined,
                  );
                } catch (error) {
                  logger.error('health report from a scan could not be ingested', {
                    runId: run.id,
                    artifact: name,
                    error: messageOf(error),
                  });
                }
              },
            }),
      }),
    );
    target.route('/', createAgentRoutes({ registry: agentRegistry }));
    target.route(
      '/',
      createAnalyticsTrendRoutes({
        store: executionStore,
        workspaceId: workspaceId,
      }),
    );
    target.route(
      '/',
      createInsightsRoutes({
        store: executionStore,
        workspaceId: workspaceId,
        // Triage labels live in the database; an in-memory install has none.
        ...(databaseResources === undefined
          ? {}
          : {
              labels: () =>
                listTriageLabels({
                  db: databaseResources.db,
                  workspaceId: workspaceId,
                }),
            }),
      }),
    );
    target.route('/', createChatRoutes({ gateway: gateways.chat }));
    target.route(
      '/',
      createCopilotRoutes({
        store: executionStore,
        workspaceId: workspaceId,
        gateway: gateways.chat,
      }),
    );
    // Settings → AI, Integrations, Identity, Sessions & retention. Installation-wide, so every
    // workspace's composition serves the one service; writes need an installation admin (or,
    // while single sign-on is enforced, an admin of the home workspace).
    const home = workspaceId === (runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID);
    target.route(
      '/',
      createSettingsRoutes({ access, settings: settingsService, testers: settingTesters, home }),
    );
    target.route(
      '/',
      createIdentitySettingsRoutes({
        access,
        home,
        settings: settingsService,
        drafts: identityDrafts,
        publicAppUrl: installationPublicUrl,
        breakGlass: runtimeConfig.breakGlass === true,
      }),
    );

    /**
     * The project registry and the derived QA score.
     *
     * Mounted behind the same database handle as everything else, and **only when one
     * exists** — the registry is not useful without persistence, and a process that
     * booted without `DATABASE_URL` would otherwise answer a score request with an
     * empty one rather than with "this install has no registry".
     *
     * `startRun` is the one piece of this group that is not a pure read, and it is
     * injected rather than constructed here: the queue, the runner client and the
     * idempotency store are all assembled elsewhere, and a route group that builds its
     * own would be a second way to start a run.
     */
    if (databaseResources !== undefined) {
      const registry: ProjectRegistryServiceOptions = {
        db: databaseResources.db as never,
        workspaceId: workspaceId,
        viewFor: (repoPath) => fileSystemView(repoPath),
      };
      /**
       * The configured workspace exists before anything is written under it.
       *
       * Every workspace-scoped table has a `restrict` key onto `workspaces` since 0028, so a
       * run, a test, a quarantine entry or an audit row naming an unregistered workspace is
       * refused. The row used to be created only when a project was registered — so a
       * reporter-only install with a `WORKSPACE_ID` other than the `default-workspace` 0003
       * seeds would have had every upload refused. Idempotent, and not swallowed: an API that
       * cannot register its own workspace cannot write anything, and should say so at boot.
       */
      /**
       * Vault key rotation, at boot: with `VAULT_SECRET_PREVIOUS` set beside a new `VAULT_SECRET`,
       * every entry of the workspace is re-sealed under the new secret in one transaction and its
       * `key_version` raised. Run again with both still set, it changes nothing. An entry that
       * opens under neither stops the boot: an API that cannot open its own vault would fail
       * every credential read, and saying so here is shorter than that diagnosis.
       */
      target.route(
        '/',
        createProjectsRoutes({
          ...registry,
          defaultWorkspace,
          onboarding: { aiConfigured: async () => (await liveAi.provider()) !== null },
          vaultSecret: runtimeConfig.vaultSecret,
          // The built-in eval runner uses the raw gateway: its runs are eval runs, not chat.
          agents: {
            gateway: evalGateway,
            provider: chatProvider,
            onRunFailure: (error) =>
              logger.warn('an eval dataset run failed', { error: messageOf(error) }),
          },
          secureCookies: resolveSecureCookies(),
          trustProxy: runtimeConfig.trustProxy === true,
          pairing: {
            pepper: authCookieSecret,
            publicAppUrl: installationUrl,
          },
          notifications: {
            link: `${installationUrl.replace(/\/$/u, '')}/dashboard/now`,
            ...dispatchNowHook,
          },
          // The installation key's session is the admin; tokens carry their own role. With
          // ACCESS_CONTROL=open, a caller with neither is the single operator ADR-006 describes.
          access: access,
          issues: { jira: jiraAdapter, github: githubAdapter, detailsUrl: dashboardUrl },
          testProposals: {
            gateway: gateways.testProposals,
            provider: chatProvider,
          },
          // The runs `lupin test` records are the history a shard plan reads.
          shardHistory: runRepository,
          // The same run repository, canonical store and bus the reporter upload door writes,
          // and the same quarantine every gate evaluation reads.
          testReports: {
            repository: runRepository,
            canonicalStore: resolveReporterStore(),
            bus: realtimeBus,
            quarantined: quarantineFor,
            applyPolicy: (projectId) =>
              applyProjectQuarantinePolicy(
                { ...registry, store: dashboardStores.quarantineStore, history: workspaceHistory },
                projectId,
              ),
          },
          quarantine: { store: dashboardStores.quarantineStore, history: workspaceHistory },
          ...scimDefaultRole,
          delivery: deliveryHooks,
          health: {
            ...healthHooks,
            detailsUrl: dashboardUrl,
            // The commit's test run, read with the same quarantine and the same rule the gate and
            // `lupin test` use.
            commitTests: (projectId, commit) =>
              commitTests(
                {
                  repository: runRepository,
                  quarantined: () => quarantineFor(registry.workspaceId),
                  reportErrors: async (runId) =>
                    (await resolveReporterStore().get(runId))?.reportErrors?.length ?? 0,
                  labelledSignatures: async () =>
                    new Set((await listTriageLabels(registry)).map((label) => label.signature)),
                },
                projectId,
                commit,
              ),
            github: {
              adapter: githubAdapter,
              tokenFor: (projectId) =>
                readGitToken(
                  { ...registry, vaultSecret: runtimeConfig.vaultSecret },
                  projectId,
                ).catch(() => null),
            },
            reporterSecret: runtimeConfig.reporterSecret,
            requireReporterSecret: runtimeConfig.nodeEnv === 'production',
            // Scanners a live runner advertises, in RUNNER_CAPABILITIES. The pool is the
            // installation's, so every workspace's scan is offered the same runners.
            scannerCapabilities: () => poolCapabilities({ db: databaseResources.db as never }),
            // One run per scanner, claimable only by a runner that has the binary.
            startScanJob: async (job) => {
              const created = await executionStore.create(
                {
                  projectId: job.projectId,
                  timeoutMs: 20 * 60_000,
                  source: 'web',
                  framework: 'tool',
                  testType: 'health',
                  suite: `health: ${job.scanner.label}`,
                  requiredCapabilities: [job.scanner.id],
                  configuration: {
                    commandId: `health:${job.scanner.id}`,
                    health: job.health,
                    command: {
                      argv: [...job.scanner.argv],
                      workingDirectory: '.',
                      ...(job.repository === null ? {} : { repository: job.repository }),
                      artifactGlobs: [job.scanner.output],
                      env: [],
                      evidence: 'artifact',
                    },
                    ...(job.gitUrl === null
                      ? {}
                      : { checkout: { url: job.gitUrl, projectId: job.projectId } }),
                  },
                },
                randomUUID(),
                registry.workspaceId,
              );
              return { runId: created.run.id };
            },
          },
          // `.github` and `.husky` are walked for the scan only: they are where CI and the
          // commit gates are declared, and the detector has no use for either.
          scanner: createRepoScanner({
            viewFor: (repoPath) => fileSystemView(repoPath, DEFAULT_IGNORED, ['.github', '.husky']),
          }),
          // The argv arrives **already resolved** by `run.start` against the profile or
          // the scan, and is written into the job as-is. It used to be dropped here — the
          // job carried only `commandId`, the runner reads `configuration.command`, and so
          // every project run was a Playwright job with no project: a run that could not
          // execute the command the operator chose.
          startRun: async (input) => {
            const created = await executionStore.create(
              {
                projectId: input.projectId,
                timeoutMs: input.timeoutMs ?? 30 * 60_000,
                source: 'web',
                framework: input.command.evidence === 'artifact' ? 'detected' : 'tool',
                testType: 'tool',
                suite: input.command.label,
                // **No `labels`.** A job's labels are routing constraints — a runner claims it
                // only if it carries every one — so the tool id there made the job unclaimable.
                // The id is kept in `configuration.commandId`, which is what history reads.
                configuration: {
                  commandId: input.commandId,
                  command: {
                    argv: input.command.argv,
                    workingDirectory: input.command.workingDirectory,
                    ...(input.command.repository === undefined
                      ? {}
                      : { repository: input.command.repository }),
                    artifactGlobs: input.command.artifactGlobs,
                    env: input.command.env,
                    evidence: input.command.evidence,
                  },
                },
              },
              input.idempotencyKey,
              workspaceId,
            );
            return {
              runId: created.run.id,
              jobId: created.job.id,
              phase: created.run.phase,
            };
          },
          // The readiness card's inputs beyond the registry: the run history, and the
          // quarantined tests still waiting for a person to decide.
          reliability: {
            store: executionStore,
            openQuarantine: async () =>
              ((await dashboardStores.quarantineStore?.list()) ?? []).filter(
                (entry) => entry.status === 'pending',
              ).length,
          },
        }),
      );
      /**
       * The registry points at the folder this install was pointed at, once, at boot.
       *
       * **Not a watcher and not a poll.** "The moment you open the folder" is satisfied
       * by the server starting when you start it, and a file watcher here would be a
       * second thing that decides what the cockpit shows.
       *
       * `discoverProjectAtBoot` owns the whole failure policy: an absent
       * `LUPIN_PROJECT_ROOT` logs and returns, and a discovery failure logs and
       * returns, because a dashboard that will not boot over a folder with no
       * `package.json` is worse than a dashboard with nothing in it.
       */
    }
    target.route(
      '/',
      createEventsRoutes({
        bus: realtimeBus,
        feed: realtimeFeed,
        workspaceId: workspaceId,
      }),
    );
    // T18: dashboard module — /api/v1/dashboard/* routes
    target.route(
      '/',
      createDashboardModule({
        repository: runRepository,
        quarantineStore: dashboardStores.quarantineStore,
        qualityGateStore: dashboardStores.qualityGateStore,
      }),
    );
    mountReportingRoutes(target);
    // Process-local, so one copy: a second would split its in-memory state.
    if (workspaceId === defaultWorkspace) mountLegacyProcessLocalRoutes(target);
  }

  return {
    workspaceId,
    executionStore,
    agentCatalog,
    durableRealtimeBus,
    access,
    mount,
  };
}

const defaultWorkspace = runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID;
const defaultParts = buildWorkspace(defaultWorkspace);
const executionStore = defaultParts.executionStore;
const agentCatalog = defaultParts.agentCatalog;
const durableRealtimeBus = defaultParts.durableRealtimeBus;
const accessResolver = defaultParts.access;

app.use(requestContext);
if (otlpExporter !== undefined) app.use(otlpRequestSpans(otlpExporter));
app.use('*', createSecurityHeaders({ allowedOrigins: resolveAllowedOrigins() }));
/**
 * Who is calling, for every role guard in the process — one resolver, so the projects
 * routes and the table in `http/route-access.ts` cannot disagree about a credential.
 * Without a database there are no access tokens, so only an installation session counts.
 */
// Before any route is mounted: Hono runs matching handlers in registration order.
app.use(
  '*',
  createClientAllowlist({
    cidrs: runtimeConfig.allowedClientCidrs ?? [],
    // Only a reachable install filters. On loopback the peer is this machine, and the list
    // would only stand between an operator and their own dashboard.
    enabled: !isLoopbackBind(runtimeConfig.exposedBind ?? runtimeConfig.host ?? '127.0.0.1'),
    clientKey: (context) => defaultClientKey(context, runtimeConfig.trustProxy ?? false),
  }),
);
app.use('*', createOriginCheck({ allowedOrigins: resolveAllowedOrigins() }));
// The client address for the audit trail, read the same way the allowlist reads it.
app.use('*', async (context, next) => {
  recordClientAddress(defaultClientKey(context, runtimeConfig.trustProxy ?? false));
  await next();
});

/**
 * A server-side deadline on every request that is not a long-lived stream.
 *
 * `GET /api/v1/events` is an SSE stream: refusing it halfway through would close a
 * working subscription, which is a different failure from a slow request. It is
 * the one exemption, and it is here rather than inside the middleware so the
 * decision of what to exempt is made where the routes are known.
 */
app.use(
  '*',
  createRequestDeadline({
    budgetMs: Number(process.env['REQUEST_DEADLINE_MS'] ?? 30_000),
    exemptPaths: [
      '/api/v1/events',
      // A streaming completion outlives the handler that started it — the deadline
      // disarms when the handler returns, while the body is still being consumed —
      // so the middleware budget cannot reach the provider. The route carries its
      // own, from `CHAT_TIMEOUT_MS`. Listed here so the exemption is a recorded
      // decision rather than a gap nobody noticed.
      '/api/v1/chat/completions',
    ],
    onTimeout: ({ path, method, budgetMs }) =>
      console.error(`request exceeded its ${String(budgetMs)}ms deadline: ${method} ${path}`),
  }),
);

/**
 * **No authentication middleware.** The install is open.
 *
 * Removed rather than bypassed, on 2026-09-30. A self-hosted, single-tenant install
 * has one operator and no second party to authenticate *to*: `WORKSPACE_ID` is the
 * only tenancy boundary the product has, and ADR-006 puts multi-tenant isolation
 * out of scope for v1.0.0. A credential in front of it would be an obstacle with
 * nothing behind it — and one that had already produced three defects of its own:
 * two files holding the key and disagreeing (E2E-1), a runner secret the lane never
 * had (E2E-1's sibling), and a "this route is not public" check that was itself
 * authenticated and proved nothing.
 *
 * **What this means, stated plainly rather than left to be discovered.** Anything
 * that can reach the API can read every run, download every artifact, and cancel
 * runs. That is the correct posture for a box on an operator's own network, and it
 * is the wrong posture for the same box on a public interface. The boundary is the
 * network, so **bind the API to loopback** — `HOST=127.0.0.1`, which is already the
 * default — and put a reverse proxy in front of it if it must be reachable from
 * anywhere else.
 *
 * The session and key routes are still mounted: they mint nothing and are no longer
 * required, and a client that happens to send a credential is not refused for it.
 */

/**
 * The readiness probe's view of the durable bus, or nothing when there is none.
 *
 * Built once rather than inline at the call site: a `let` captured in a closure
 * loses its narrowing, so an inline `durableRealtimeBus === undefined ? … : …` is
 * checked against the `undefined` branch and the handler is typed as reporting
 * nothing — which is the opposite of what it does.
 */
const degradedRealtimeBus: (() => Record<string, string>) | undefined = (() => {
  if (durableRealtimeBus === undefined) return undefined;
  // The inner return is annotated because inference widens the empty `{}` to
  // `{ realtimeBus?: undefined }`, which is not assignable to
  // `Record<string, string>` — the error then lands on the *outer* assignment,
  // two dozen lines from the line that is actually wrong.
  return (): Record<string, string> => {
    const failure = durableRealtimeBus.lastPublishError();
    if (failure === null) return {};
    return {
      realtimeBus: failure instanceof Error ? failure.message : 'durable publish failed',
    };
  };
})();

app.route(
  '/',
  createHealthRoutes({
    databaseUrl: runtimeConfig.databaseUrl,
    agentAvailability: agentCatalog.available,
    profile: runtimeConfig.profile ?? 'solo',
    signIn: {
      get oidc() {
        return liveOidc !== undefined && databaseResources !== undefined;
      },
    },
    checkDatabase: databaseResources
      ? async () => {
          await databaseResources.db.execute(sql`SELECT 1`);
        }
      : undefined,
    // The bus's own view of itself, ledger O-5b. Without this the readiness
    // endpoint knows only whether the database answers, so an instance whose bus
    // has been failing to publish for an hour reports `ready` — which is the one
    // condition a readiness probe exists to catch.
    degraded: degradedRealtimeBus,
  }),
);
app.route('/', authRoutes.app);
// OIDC sign-in, always mounted: a coded 404 until OIDC_ISSUER, OIDC_CLIENT_ID and a database
// are all configured, so an install that never opted in has nothing to probe.
app.route(
  '/',
  createOidcRoutes({
    oidc: async () => liveOidc,
    // Test sign-in for a draft from Settings ? Identity: the person comes back through the
    // registered callback, and the draft records the role its rules gave them.
    test: {
      authorize: installationAdminGuard(accessResolver),
      configFor: async (draftId) => {
        const draft = identityDrafts.get(draftId);
        if (draft === undefined) return undefined;
        const merged = { ...(await currentIdentity(settingsService)), ...draft.values };
        return oidcConfigFrom(merged, installationPublicUrl);
      },
      onResult: async (draftId, identity, reason) => {
        const draft = identityDrafts.get(draftId);
        if (draft === undefined) return;
        if (identity === null) {
          logger.warn('identity test sign-in failed', { reason: reason ?? 'unknown' });
          return;
        }
        try {
          const current = await currentIdentity(settingsService);
          const merged = { ...current, ...draft.values };
          const config = oidcConfigFrom(merged, installationPublicUrl);
          identityDrafts.verify(draftId, {
            ...identity,
            role: roleUnderDraft(config, identity),
            basis: fingerprint(merged),
          });
        } catch (error) {
          // The draft no longer builds (a value changed under it): it stays unverified, and the
          // page asks for another test rather than applying something untested.
          logger.warn('identity test sign-in could not be recorded', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    ...(databaseResources === undefined ? {} : { db: databaseResources.db as never }),
    workspaceId: runtimeConfig.workspaceId ?? DEFAULT_WORKSPACE_ID,
    sessions: authRoutes.sessions,
    installationId,
    cookieSecret: authCookieSecret,
    sessionTtlMs: liveSessionTtlMs,
    secureCookies: resolveSecureCookies(),
    trustProxy: runtimeConfig.trustProxy ?? false,
    log: (message, fields) => logger.warn(message, fields),
  }),
);

/**
 * Several workspaces in one install (ADR-014). A request whose trusted credential belongs to
 * another workspace is forwarded, whole, to that workspace's own composition; the default
 * workspace's is mounted below and served in place. Only with a database: workspaces,
 * tokens, jobs and memberships are rows, and an in-memory install has the one workspace.
 */
if (databaseResources !== undefined) {
  const db = databaseResources.db;
  const lookups: WorkspaceLookups = createDatabaseWorkspaceLookups({
    db: db as never,
    defaultWorkspace,
    // A person's session, or — on team and enterprise behind Cloudflare Access — the account
    // Access signs in, so a person's memberships decide which workspace they may enter. In
    // `callerOf`'s order: the installation's own session, where it counts, comes before an
    // Access identity, and the installation admin it signs in is routed by their choice.
    sessionUser: async (context) => {
      const record = await sessionOf(context);
      if (record?.userId !== undefined) return record.userId;
      if (record !== undefined && browserCredentialsCount(accessResolver)) return null;
      return (await cloudflarePeople?.userId(context)) ?? null;
    },
    installationLevel: async (context) =>
      isInstallationAdmin(await callerOf(context, accessResolver)),
  });
  // A browser's token cookie steers only where it signs anyone in (`callerOf`'s rule).
  lookups.browserCredentials = browserCredentialsCount(accessResolver);
  // Before the dispatch: these are about which workspace to be in.
  app.route(
    '/',
    createWorkspacesRoutes({
      db: db as never,
      defaultWorkspace,
      profile: runtimeConfig.profile ?? 'solo',
      secureCookies: resolveSecureCookies(),
      defaultCaller: (context) => callerOf(context, accessResolver),
      sessionUser: lookups.sessionUser,
      current: (context) => resolveRequestWorkspace(context, lookups),
    }),
  );
  app.use(
    '*',
    createWorkspaceDispatch({
      lookups,
      compose: (workspaceId) => {
        const composition = new Hono();
        composition.onError(errorBoundary.onError);
        composition.notFound(errorBoundary.notFound);
        buildWorkspace(workspaceId).mount(composition);
        return composition;
      },
    }),
  );
}
defaultParts.mount(app);

/**
 * Boot steps that run once, not once per composition.
 *
 * The configured workspace exists before anything is written under it: every
 * workspace-scoped table has a `restrict` key onto `workspaces` since 0028, so a run, a test,
 * a quarantine entry or an audit row naming an unregistered workspace is refused. Idempotent,
 * and not swallowed: an API that cannot register its own workspace cannot write anything.
 *
 * Vault key rotation: with `VAULT_SECRET_PREVIOUS` set beside a new `VAULT_SECRET`, every
 * workspace's entries are re-sealed under the new secret and their `key_version` raised. An
 * entry that opens under neither stops the boot.
 *
 * `LUPIN_PROJECT_ROOT` is registered in the default workspace, once.
 */
if (databaseResources !== undefined) {
  const registry: ProjectRegistryServiceOptions = {
    db: databaseResources.db as never,
    workspaceId: defaultWorkspace,
    viewFor: (repoPath) => fileSystemView(repoPath),
  };
  await ensureWorkspace(registry);
  const previousVaultSecret = process.env['VAULT_SECRET_PREVIOUS']?.trim();
  if (
    previousVaultSecret !== undefined &&
    previousVaultSecret !== '' &&
    runtimeConfig.vaultSecret !== undefined
  ) {
    const all = await databaseResources.db.select({ id: workspaces.id }).from(workspaces);
    for (const { id } of all) {
      const rotation = await rotateVaultSecrets(
        { ...registry, workspaceId: id, actor: 'system:boot' },
        previousVaultSecret,
        runtimeConfig.vaultSecret,
      );
      logger.info('vault rotation checked', { workspaceId: id, ...rotation });
    }
  }
  await discoverProjectAtBoot(registry, runtimeConfig.projectRoot, logger);
}

/**
 * How long a stopping API lets requests finish before it cuts off what is left (event streams
 * never finish on their own), and the whole budget before it gives up and exits non-zero. The
 * budget is under the 10 s a container runtime allows by default before it sends SIGKILL.
 */
const SHUTDOWN_DRAIN_MS = 5_000;
const SHUTDOWN_BUDGET_MS = 8_000;

export { app, executionStore };

if (runtimeConfig.nodeEnv !== 'test') {
  const { serve } = await import('@hono/node-server');
  // Startup policy already ran above, before any composition; the server only
  // starts once that gate has passed.
  const server = serve(
    { fetch: app.fetch, port: runtimeConfig.port, hostname: runtimeConfig.host },
    (info) => {
      console.info(`lupin-api listening on http://${runtimeConfig.host}:${info.port}`);
    },
  );
  // Closed in the reverse of this order: the server stops taking requests, then the sweep stops,
  // and the pool goes last so nothing is mid-query when its connections are taken away.
  const lifecycle = new Lifecycle((name, error) => {
    logger.error('failed to close during shutdown', {
      resource: name,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  if (databaseResources) lifecycle.add('database pool', () => databaseResources.close());
  if (settingsPoll) lifecycle.add('settings poll', () => clearInterval(settingsPoll));
  if (retentionSweep) lifecycle.add('outbox retention sweep', () => retentionSweep.stop());
  if (spanRetentionSweep) {
    lifecycle.add('genai span retention sweep', () => spanRetentionSweep.stop());
  }
  if (sessionRetentionSweep) {
    lifecycle.add('session retention sweep', () => sessionRetentionSweep.stop());
  }
  if (reportDispatcher) {
    reportDispatcher.start(Number(process.env['REPORT_DISPATCH_INTERVAL_MS'] ?? 15_000));
    lifecycle.add('report dispatcher', () => reportDispatcher.stop());
  }
  if (deliverySyncer) {
    // Bounded (a whole number, 10 s or more) by the registry schema and by `@lupin/config`, so
    // NaN cannot reach the timer. Restarted when the interval is saved from Settings.
    const startSyncer = async () => {
      const interval = await settingsService.resolve('integrations.deliverySyncIntervalMs');
      deliverySyncer.start(typeof interval === 'number' ? interval : 60_000);
    };
    inBackground(startSyncer(), 'start the delivery syncer');
    let restarting: Promise<void> = Promise.resolve();
    settingsService.subscribe((key) => {
      if (key !== 'integrations.deliverySyncIntervalMs') return;
      // Serialised, so two quick saves cannot interleave a stop with a start.
      restarting = restarting
        .then(() => deliverySyncer.stop())
        .then(startSyncer)
        .catch((error: unknown) =>
          logger.warn('could not restart the delivery syncer', {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    });
    lifecycle.add('delivery syncer', () => deliverySyncer.stop());
  }
  if (otlpExporter !== undefined) {
    otlpExporter.start(5_000);
    // Added before the server, so it closes after it: the last requests' spans are sent.
    lifecycle.add('otlp trace exporter', () => otlpExporter.stop());
  }
  lifecycle.add('http server', () => closeHttpServer(server, SHUTDOWN_DRAIN_MS));
  installShutdownHandlers(lifecycle, {
    process,
    exit: (code) => process.exit(code),
    log: (message) => logger.info(message),
    graceMs: SHUTDOWN_BUDGET_MS,
  });
}
