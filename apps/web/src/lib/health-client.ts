import { z } from 'zod/v4';
import {
  HealthFindingSchema,
  HealthFindingsPageSchema,
  HealthHistorySchema,
  HealthScanStartedSchema,
  PortfolioHeatmapSchema,
  PortfolioSchema,
  ProjectHealthSchema,
  ProjectQuarantineSchema,
  QuarantinePolicySchema,
  ScorecardSchema,
  PaceReportSchema,
  PortfolioPhasesSchema,
  RepositoryPhasesSchema,
  BriefingResponseSchema,
  type BriefingResponse,
  PortfolioShapeSchema,
  ScopedShapeSchema,
  type PortfolioShape,
  type ScopedShape,
  type FindingSeverity,
  type FindingState,
  type HealthDimension,
  type HealthFinding,
  type HealthFindingsPage,
  type HealthHistory,
  type HealthScanStarted,
  type Portfolio,
  type ProjectHealth,
  type ProjectQuarantine,
  type QuarantinePolicy,
  type TriageFindingBody,
  type PortfolioHeatmap,
  type Scorecard,
  type PaceReport,
  type PortfolioPhases,
  type RepositoryPhases,
} from '@lupin/shared-contracts';
import { parse } from './qa-client.js';

/**
 * The repository health data layer.
 *
 * Same two rules as `qa-client.ts`: every response is parsed against the server's own
 * contract, and every path is built here, so no screen concatenates a project id into a URL.
 */
export interface FindingQuery {
  dimension?: HealthDimension | undefined;
  severity?: FindingSeverity | undefined;
  state?: FindingState | undefined;
  tool?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface HealthClient {
  getPortfolio(): Promise<Portfolio>;
  /** Every project's dimensions and scorecards on one grid. */
  getHeatmap(): Promise<PortfolioHeatmap>;
  /** The test-effectiveness scorecard: mutation score, diff coverage, flakes and causes. */
  getTestEffectiveness(projectId: string): Promise<Scorecard>;
  /** Whether testing keeps up with the code: weekly pace and the untested-change debt. */
  getPace(projectId: string, weeks?: number): Promise<PaceReport>;
  /** Each SDLC phase across the repository's changes, the bottleneck, and what is stuck. */
  getPhases(projectId: string, days?: number): Promise<RepositoryPhases>;
  /** Every repository's shape per SDLC phase, worst first. */
  getPortfolioPhases(days?: number): Promise<PortfolioPhases>;
  /**
   * What happened over the window, every line cited: one repository, or the portfolio when
   * `projectId` is null. `narrate` asks the configured model to reword it, held to its lines.
   */
  getBriefing(
    projectId: string | null,
    options?: { days?: number; narrate?: boolean },
  ): Promise<BriefingResponse>;
  /** Good or bad shape, and how fresh the evidence is: one repository. */
  getShape(projectId: string): Promise<ScopedShape>;
  /** One pull request's shape. Refused when the delivery sync has not read it. */
  getPullRequestShape(projectId: string, number: number): Promise<ScopedShape>;
  /** The workspace's shape, and every repository's, worst first. */
  getPortfolioShape(): Promise<PortfolioShape>;
  getHealth(projectId: string): Promise<ProjectHealth>;
  getFindings(projectId: string, query?: FindingQuery): Promise<HealthFindingsPage>;
  getHistory(projectId: string, days: number): Promise<HealthHistory>;
  triage(projectId: string, findingId: string, body: TriageFindingBody): Promise<HealthFinding>;
  /** Runs the repository's health scanners. A command id list never leaves the server. */
  startScan(projectId: string): Promise<HealthScanStarted>;
  whoami(): Promise<WhoAmI>;
  /** What a browser may sign in with beyond a token or the installation key (`/api/v1/features`). */
  signInMethods?(): Promise<{ oidc: boolean }>;
  /** Signs this browser in with an access token, or with the installation key. */
  signIn(credential: string): Promise<void>;
  signOut(): Promise<void>;
  listTokens(): Promise<AccessTokenSummary[]>;
  createToken(body: {
    name: string;
    role: TokenRole;
    projectId?: string;
    /** Days until it stops working; omitted, never. */
    expiresInDays?: number;
    /** A subset of the role's permissions (plan task 7); omitted, the whole role. */
    scopes?: string[];
  }): Promise<{ token: string; summary: AccessTokenSummary }>;
  revokeToken(id: string): Promise<AccessTokenSummary>;
  /** Issues a successor and ends the old token after a day's grace (plan task 6). */
  rotateToken?(id: string): Promise<{ token: string; summary: AccessTokenSummary }>;
  /** Issues a six-digit code that pairs one device. Admin only. */
  issuePairingCode(body: { deviceName: string; role: 'viewer' | 'operator' }): Promise<PairingCode>;
  /** Spends a pairing code: this browser is signed in as the code's role. */
  pair(code: string): Promise<{ role: 'viewer' | 'operator'; deviceName: string }>;
  getSettings(projectId: string): Promise<HealthSettings>;
  setSchedule(
    projectId: string,
    cadence: 'daily' | 'weekly' | null,
  ): Promise<{ cadence: 'daily' | 'weekly' | null; scanners: string[] }>;
  setAlerts(
    projectId: string,
    alerts: { slackChannel?: string | null; webhookUrl?: string | null },
  ): Promise<void>;
  /** The project's quarantine: its policy, and each entry with owner, cost and streak. */
  getProjectQuarantine(projectId: string): Promise<ProjectQuarantine>;
  /** Sets `off`, `suggest` or `auto`. Admin only. */
  setQuarantinePolicy(projectId: string, policy: QuarantinePolicy): Promise<QuarantinePolicy>;
}

export const HealthSettingsSchema = z.object({
  alerts: z.object({
    slackChannel: z.string().nullable().optional(),
    webhookUrl: z.string().nullable().optional(),
  }),
  schedule: z.enum(['daily', 'weekly']).nullable(),
  codeowners: z.boolean(),
});
export type HealthSettings = z.infer<typeof HealthSettingsSchema>;

export const WhoAmISchema = z.object({
  actor: z.string(),
  role: z.enum(['viewer', 'operator', 'admin']).nullable(),
  mode: z.enum(['open', 'enforced']),
  /** The deployment profile (ADR-014). Absent from an API older than profiles. */
  profile: z.enum(['solo', 'startup', 'team', 'enterprise']).optional(),
  /** Where this caller's credential came from. Absent from an API older than profiles. */
  source: z.enum(['token', 'user', 'cloudflare', 'installation', 'anonymous']).optional(),
  /** The workspace this request is in. Absent from an API older than several workspaces. */
  workspace: z.string().optional(),
  /** Whether this caller may change installation-wide settings. Absent from an older API. */
  installationAdmin: z.boolean().optional(),
});
export type WhoAmI = z.infer<typeof WhoAmISchema>;

/** The part of `/api/v1/features` the sign-in screen reads. Absent from older APIs. */
const FeaturesSignInSchema = z.object({
  signIn: z.object({ oidc: z.boolean() }).optional(),
});

export const TOKEN_ROLES = ['viewer', 'operator', 'admin', 'uploader'] as const;
export type TokenRole = (typeof TOKEN_ROLES)[number];

export const AccessTokenSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(TOKEN_ROLES),
  projectId: z.string().nullable(),
  displayPrefix: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /** Absent from an older API, and then read as never. */
  expiresAt: z.string().nullable().optional(),
  /** Absent from an older API, and then read as the whole role. */
  scopes: z.array(z.string()).nullable().optional(),
});
export type AccessTokenSummary = z.infer<typeof AccessTokenSummarySchema>;

/**
 * The permissions each role may be scoped down to. The API's `ROLE_PERMISSIONS` decides; this
 * copy only chooses which boxes to offer, and a box the API refuses is reported as an error.
 */
export const ROLE_SCOPES: Readonly<Record<Exclude<TokenRole, 'uploader'>, readonly string[]>> = {
  viewer: ['runs:read', 'tests:read', 'settings:read'],
  operator: ['runs:read', 'runs:write', 'tests:read', 'tests:write', 'settings:read', 'ai:use'],
  admin: [
    'runs:read',
    'runs:write',
    'tests:read',
    'tests:write',
    'settings:read',
    'settings:write',
    'vault:read',
    'vault:write',
    'ai:use',
    'connectors:manage',
  ],
};

export const PairingCodeSchema = z.object({
  id: z.string(),
  code: z.string().regex(/^\d{6}$/u),
  deviceName: z.string(),
  role: z.enum(['viewer', 'operator']),
  expiresAt: z.string(),
  pairUrl: z.string(),
});
export type PairingCode = z.infer<typeof PairingCodeSchema>;

function search(query: FindingQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text.length === 0 ? '' : `?${text}`;
}

export function createHealthClient(baseUrl = '', fetchImpl: typeof fetch = fetch): HealthClient {
  const project = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}`;

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      method: 'GET',
    });
    return parse(response, schema, path);
  }

  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parse(response, schema, path);
  }

  async function put<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parse(response, schema, path);
  }

  return {
    getPortfolio: () => get('/api/v1/portfolio', PortfolioSchema),
    getHeatmap: () => get('/api/v1/portfolio/heatmap', PortfolioHeatmapSchema),
    getTestEffectiveness: (projectId) =>
      get(`${project(projectId)}/test-effectiveness/scorecard`, ScorecardSchema),
    getPhases: (projectId, days = 30) =>
      get(`${project(projectId)}/phases?days=${String(days)}`, RepositoryPhasesSchema),
    getPortfolioPhases: (days = 30) =>
      get(`/api/v1/portfolio/phases?days=${String(days)}`, PortfolioPhasesSchema),
    getBriefing: (projectId, { days = 7, narrate = false } = {}) =>
      get(
        `${projectId === null ? '/api/v1/portfolio' : project(projectId)}/briefing?days=${String(days)}&narrate=${String(narrate)}`,
        BriefingResponseSchema,
      ),
    getShape: (projectId) => get(`${project(projectId)}/shape`, ScopedShapeSchema),
    getPullRequestShape: (projectId, number) =>
      get(`${project(projectId)}/pull-requests/${String(number)}/shape`, ScopedShapeSchema),
    getPortfolioShape: () => get('/api/v1/portfolio/shape', PortfolioShapeSchema),
    getPace: (projectId, weeks = 8) =>
      get(`${project(projectId)}/pace?weeks=${String(weeks)}`, PaceReportSchema),
    getHealth: (projectId) => get(`${project(projectId)}/health`, ProjectHealthSchema),
    getFindings: (projectId, query = {}) =>
      get(`${project(projectId)}/health/findings${search(query)}`, HealthFindingsPageSchema),
    getHistory: (projectId, days) =>
      get(
        `${project(projectId)}/health/history?days=${String(Math.trunc(days))}`,
        HealthHistorySchema,
      ),
    triage: (projectId, findingId, body) =>
      post(
        `${project(projectId)}/health/findings/${encodeURIComponent(findingId)}/triage`,
        body,
        HealthFindingSchema,
      ),
    startScan: (projectId) =>
      post(`${project(projectId)}/health/scan`, {}, HealthScanStartedSchema),
    whoami: () => get('/api/v1/auth/whoami', WhoAmISchema),
    signInMethods: async () =>
      (await get('/api/v1/features', FeaturesSignInSchema)).signIn ?? { oidc: false },
    // A token from an admin starts with the access-token prefix; anything else is the
    // installation key, which signs in as the admin through the existing login.
    signIn: async (credential) => {
      const trimmed = credential.trim();
      if (trimmed.startsWith('lup_')) {
        await post('/api/v1/auth/token-login', { token: trimmed }, z.object({}).passthrough());
      } else {
        await post('/api/v1/auth/login', { apiKey: trimmed }, z.object({}).passthrough());
      }
    },
    signOut: async () => {
      await post('/api/v1/auth/token-logout', {}, z.object({}).passthrough());
      await post('/api/v1/auth/logout', {}, z.object({}).passthrough()).catch(() => undefined);
    },
    listTokens: async () =>
      (await get('/api/v1/access-tokens', z.object({ tokens: z.array(AccessTokenSummarySchema) })))
        .tokens,
    createToken: (body) =>
      post(
        '/api/v1/access-tokens',
        body,
        z.object({ token: z.string(), summary: AccessTokenSummarySchema }),
      ),
    rotateToken: (id) =>
      post(
        `/api/v1/access-tokens/${encodeURIComponent(id)}/rotate`,
        {},
        z.object({ token: z.string(), summary: AccessTokenSummarySchema }),
      ),
    getSettings: (projectId) => get(`${project(projectId)}/health/settings`, HealthSettingsSchema),
    setSchedule: (projectId, cadence) =>
      put(
        `${project(projectId)}/health/schedule`,
        { cadence },
        z.object({
          cadence: z.enum(['daily', 'weekly']).nullable(),
          scanners: z.array(z.string()),
        }),
      ),
    setAlerts: async (projectId, alerts) => {
      await put(`${project(projectId)}/health/alerts`, alerts, z.object({}).passthrough());
    },
    getProjectQuarantine: (projectId) =>
      get(`${project(projectId)}/quarantine`, ProjectQuarantineSchema),
    setQuarantinePolicy: (projectId, policy) =>
      put(`${project(projectId)}/quarantine/policy`, policy, QuarantinePolicySchema),
    revokeToken: async (id) => {
      const path = `/api/v1/access-tokens/${encodeURIComponent(id)}`;
      const response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        method: 'DELETE',
      });
      return parse(response, AccessTokenSummarySchema, path);
    },
    issuePairingCode: (body) => post('/api/v1/pairing-codes', body, PairingCodeSchema),
    pair: (code) =>
      post(
        '/api/v1/pair',
        { code: code.trim() },
        z.object({ role: z.enum(['viewer', 'operator']), deviceName: z.string() }),
      ),
  };
}
