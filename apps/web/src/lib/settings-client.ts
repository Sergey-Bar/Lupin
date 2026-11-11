import { z } from 'zod/v4';
import {
  OnboardingSchema,
  SettingReadSchema,
  SettingsListSchema,
  SettingTestResultSchema,
  type Onboarding,
  type SettingRead,
  type SettingTestResult,
} from '@lupin/shared-contracts';
import { QaApiError } from './qa-client.js';

/**
 * Settings, setup and project administration.
 *
 * Its own error type because these screens need more of the API's answer than a sentence:
 * the `code` (an `ENV_LOCKED` field is drawn locked, not failed) and `details.fix`, the
 * one-line next step every error on these routes carries.
 */
export class SettingsApiError extends QaApiError {
  constructor(
    status: number,
    detail: string,
    readonly code: string | null,
    readonly fix: string | null,
  ) {
    super(status, detail);
    this.name = 'SettingsApiError';
  }
}

/** The sentence to show for a failed call: what happened, then what to do. */
export function explain(error: unknown, fallback: string): string {
  if (error instanceof SettingsApiError) {
    return error.fix === null ? error.detail : `${error.detail} ${error.fix}`;
  }
  const detail = (error as { detail?: unknown } | null)?.detail;
  return typeof detail === 'string' && detail.length > 0 ? detail : fallback;
}

const RegisteredSchema = z.object({
  project: z.object({ id: z.string(), name: z.string() }).passthrough(),
  commands: z.array(z.object({ id: z.string(), label: z.string() }).passthrough()),
});
export type RegisteredProject = z.infer<typeof RegisteredSchema>;

const ProjectEditSchema = z.object({
  project: z.object({ id: z.string(), name: z.string(), defaultBranch: z.string().nullable() }),
});
const TokenStateSchema = z.object({ set: z.boolean() });
const OkSchema = z.object({}).passthrough();

export const QualityGateSchema = z.object({
  id: z.string(),
  name: z.string(),
  passRateThreshold: z.number(),
  createdAt: z.string(),
});
export type QualityGate = z.infer<typeof QualityGateSchema>;

export type ConnectRepositoryBody =
  | { name: string; slug: string; repoPath: string }
  | { name: string; slug: string; gitUrl: string; defaultBranch?: string; token?: string };

export interface SettingsClient {
  listSettings(): Promise<SettingRead[]>;
  putSetting(key: string, value: string | number | boolean): Promise<SettingRead>;
  revertSetting(key: string): Promise<SettingRead>;
  testSetting(key: string, value: string | number | boolean): Promise<SettingTestResult>;
  getOnboarding(): Promise<Onboarding>;
  dismissStep(step: string): Promise<Onboarding>;
  resetOnboarding(): Promise<Onboarding>;
  registerProject(body: ConnectRepositoryBody): Promise<RegisteredProject>;
  updateProject(id: string, body: { name?: string; defaultBranch?: string }): Promise<void>;
  deleteProject(id: string, confirm: string): Promise<void>;
  /** Re-reads the repository's manifests; answers with the commands found now. */
  detectProject(id: string): Promise<number>;
  gitTokenState(id: string): Promise<boolean>;
  putGitToken(id: string, token: string): Promise<void>;
  deleteGitToken(id: string): Promise<void>;
  /** Whether the workspace has a GitHub App; its key is never returned. */
  githubAppState(): Promise<boolean>;
  putGitHubApp(body: { appId: string; privateKey: string }): Promise<void>;
  deleteGitHubApp(): Promise<void>;
  listGates(): Promise<QualityGate[]>;
  createGate(body: { name: string; passRateThreshold: number }): Promise<QualityGate>;
  updateGate(id: string, body: { name?: string; passRateThreshold?: number }): Promise<QualityGate>;
  deleteGate(id: string): Promise<void>;
  /** Saves sign-in changes as a draft; a test sign-in or an apply follows. */
  identityDraft(values: Record<string, string | number | boolean>): Promise<IdentityDraft>;
  identityDraftStatus(id: string): Promise<IdentityDraftStatus>;
  identityApply(id: string): Promise<void>;
}

export const IdentityDraftSchema = z.object({
  id: z.string(),
  needsTest: z.boolean(),
  testUrl: z.string(),
  expiresAt: z.string(),
});
export type IdentityDraft = z.infer<typeof IdentityDraftSchema>;

export const IdentityDraftStatusSchema = z.object({
  id: z.string(),
  verified: z
    .object({
      email: z.string(),
      groups: z.array(z.string()),
      role: z.enum(['viewer', 'operator', 'admin']).nullable(),
    })
    .nullable(),
});
export type IdentityDraftStatus = z.infer<typeof IdentityDraftStatusSchema>;

function errorOf(body: unknown, status: number): SettingsApiError {
  const error =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error: unknown }).error
      : null;
  if (typeof error === 'object' && error !== null) {
    const { code, message, details } = error as {
      code?: unknown;
      message?: unknown;
      details?: { fix?: unknown };
    };
    return new SettingsApiError(
      status,
      typeof message === 'string' && message !== '' ? message : `HTTP ${String(status)}`,
      typeof code === 'string' ? code : null,
      typeof details?.fix === 'string' ? details.fix : null,
    );
  }
  return new SettingsApiError(status, `HTTP ${String(status)}`, null, null);
}

export function createSettingsClient(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): SettingsClient {
  async function call<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) throw errorOf(json, response.status);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new SettingsApiError(
        response.status,
        `Response from ${path} did not match the expected shape.`,
        null,
        'Reload the page; the API may be a different version.',
      );
    }
    return parsed.data;
  }
  const key = (value: string) => encodeURIComponent(value);
  const project = (id: string) => `/api/v1/projects/${encodeURIComponent(id)}`;
  const gate = (id: string) => `/api/v1/dashboard/quality-gates/${encodeURIComponent(id)}`;

  return {
    listSettings: async () => (await call('GET', '/api/v1/settings', SettingsListSchema)).settings,
    putSetting: (name, value) =>
      call('PUT', `/api/v1/settings/${key(name)}`, SettingReadSchema, { value }),
    revertSetting: (name) => call('DELETE', `/api/v1/settings/${key(name)}`, SettingReadSchema),
    testSetting: (name, value) =>
      call('POST', `/api/v1/settings/${key(name)}/test`, SettingTestResultSchema, { value }),
    getOnboarding: () => call('GET', '/api/v1/onboarding', OnboardingSchema),
    dismissStep: (step) =>
      call('POST', `/api/v1/onboarding/${key(step)}/dismiss`, OnboardingSchema),
    resetOnboarding: () => call('POST', '/api/v1/onboarding/reset', OnboardingSchema),
    registerProject: (body) => call('POST', '/api/v1/projects', RegisteredSchema, body),
    updateProject: async (id, body) => {
      await call('PATCH', project(id), ProjectEditSchema, body);
    },
    deleteProject: async (id, confirm) => {
      await call('DELETE', project(id), OkSchema, { confirm });
    },
    detectProject: async (id) => {
      const body = await call(
        'POST',
        `${project(id)}/detect`,
        z
          .object({ profile: z.object({ commands: z.array(z.unknown()) }).passthrough() })
          .passthrough(),
      );
      return body.profile.commands.length;
    },
    gitTokenState: async (id) =>
      (await call('GET', `${project(id)}/git-token`, TokenStateSchema)).set,
    putGitToken: async (id, token) => {
      await call('PUT', `${project(id)}/git-token`, TokenStateSchema, { token });
    },
    deleteGitToken: async (id) => {
      await call('DELETE', `${project(id)}/git-token`, TokenStateSchema);
    },
    githubAppState: async () =>
      (await call('GET', '/api/v1/settings/github-app', TokenStateSchema)).set,
    putGitHubApp: async (body) => {
      await call('PUT', '/api/v1/settings/github-app', TokenStateSchema, body);
    },
    deleteGitHubApp: async () => {
      await call('DELETE', '/api/v1/settings/github-app', TokenStateSchema);
    },
    listGates: () => call('GET', '/api/v1/dashboard/quality-gates', z.array(QualityGateSchema)),
    createGate: (body) => call('POST', '/api/v1/dashboard/quality-gates', QualityGateSchema, body),
    updateGate: (id, body) => call('PATCH', gate(id), QualityGateSchema, body),
    deleteGate: async (id) => {
      await call('DELETE', gate(id), OkSchema);
    },
    identityDraft: (values) =>
      call('POST', '/api/v1/settings/identity/draft', IdentityDraftSchema, { values }),
    identityDraftStatus: (id) =>
      call('GET', `/api/v1/settings/identity/draft/${key(id)}`, IdentityDraftStatusSchema),
    identityApply: async (id) => {
      await call('POST', '/api/v1/settings/identity/apply', OkSchema, { draftId: id });
    },
  };
}

/** A slug the API accepts, from a name a person typed: `My Shop` → `my-shop`. */
export function slugFor(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    // The decomposed accents, so `Été` is `ete` rather than `e-te`.
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return /^[a-z0-9]/u.test(slug) ? slug : `project-${slug}`.slice(0, 64);
}

/** A project name from a path or a git URL: `/src/shop` or `…/acme/shop.git` → `shop`. */
export function nameFromSource(source: string): string {
  const last = source
    .trim()
    .replace(/\.git$/u, '')
    .split(/[\\/:]/u)
    .filter(Boolean)
    .pop();
  return last ?? '';
}
