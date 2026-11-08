import { z } from 'zod/v4';

/**
 * The settings registry: every product setting an admin can change from the interface.
 *
 * **This is the one authority.** The API validates a write with `schema`, the resolver
 * knows which environment variable overrides it from `envVar`, and the web form renders
 * `label` and `help` from here. A setting declared anywhere else is a second authority.
 *
 * Precedence is environment > saved value > default: an install whose operator pinned a
 * value in the environment keeps it, and the interface shows the field as locked.
 *
 * Infrastructure stays out of the registry on purpose. A database URL, the vault key, the
 * access-control mode and the bind address are read before anything could serve a page, and
 * a page that could change them could also take the install off loopback.
 */

export const SETTING_SCOPES = ['install', 'workspace'] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number];

export const SETTING_GROUPS = ['ai', 'integrations', 'identity', 'sessions-retention'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/** `live`: the next request sees it. `next-sign-in`: a person signed in now keeps the old value. */
export const SETTING_APPLY = ['live', 'next-sign-in'] as const;
export type SettingApply = (typeof SETTING_APPLY)[number];

export type SettingKind = 'url' | 'secret' | 'integer' | 'text' | 'role' | 'boolean';

export interface SettingDefinition {
  readonly key: string;
  readonly scope: SettingScope;
  readonly group: SettingGroup;
  readonly kind: SettingKind;
  /** The environment variable that, when set, wins and locks the field. */
  readonly envVar: string;
  /** Sealed in the vault; a read returns `{ set, last4 }`, never the value. */
  readonly secret: boolean;
  readonly label: string;
  /** One sentence: what it does and why someone would change it. At most 140 characters. */
  readonly help: string;
  readonly apply: SettingApply;
  /** Unit shown beside a number field. */
  readonly unit?: string;
  readonly defaultValue?: string | number | boolean;
  readonly schema: z.ZodType;
}

export const HELP_MAX_LENGTH = 140;

const httpsOrHttpUrl = z.url();
const httpsUrl = z.url().refine((value) => value.startsWith('https://'), 'Use an https:// address');
const secretValue = z.string().trim().min(1).max(4_000);
const longSecret = z.string().trim().min(32, 'Use at least 32 characters').max(4_000);
const positive = (max: number) => z.coerce.number().int().positive().max(max);
const roleOrNone = z.enum(['viewer', 'operator', 'admin', 'none']);
/** Splits a comma list into trimmed, non-empty items. Linear, unlike a nested-quantifier regex. */
export function splitSettingList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}
const ROLE_RULE = /^(viewer|operator|admin):[^\s,]+$/u;
const DOMAIN = /^[a-z0-9.-]+$/iu;
const roleMap = z
  .string()
  .trim()
  .max(4_000)
  .refine(
    (value) => splitSettingList(value).every((rule) => ROLE_RULE.test(rule)),
    'Write rules as role:who, separated by commas, e.g. admin:alice@acme.com',
  );

const define = (definition: SettingDefinition): SettingDefinition => definition;

export const SETTINGS: readonly SettingDefinition[] = [
  // AI provider
  define({
    key: 'ai.gatewayUrl',
    scope: 'install',
    group: 'ai',
    kind: 'url',
    envVar: 'KILO_GATEWAY_URL',
    secret: false,
    label: 'Gateway address',
    help: 'The OpenAI-compatible gateway Lupin sends chat and test proposals to. Needs an API key too.',
    apply: 'live',
    schema: httpsOrHttpUrl,
  }),
  define({
    key: 'ai.apiKey',
    scope: 'install',
    group: 'ai',
    kind: 'secret',
    envVar: 'KILO_API_KEY',
    secret: true,
    label: 'Gateway API key',
    help: 'The key the gateway expects. Stored encrypted and never shown again after you save it.',
    apply: 'live',
    schema: secretValue,
  }),
  define({
    key: 'ai.ollamaBaseUrl',
    scope: 'install',
    group: 'ai',
    kind: 'url',
    envVar: 'OLLAMA_BASE_URL',
    secret: false,
    label: 'Ollama address',
    help: 'A local Ollama server to use instead of a gateway, so no prompt leaves this network.',
    apply: 'live',
    schema: httpsOrHttpUrl,
  }),
  // Integrations
  define({
    key: 'integrations.githubApiUrl',
    scope: 'install',
    group: 'integrations',
    kind: 'url',
    envVar: 'GITHUB_API_URL',
    secret: false,
    label: 'GitHub API address',
    help: 'Only for GitHub Enterprise Server. Leave empty to use github.com.',
    apply: 'live',
    schema: httpsUrl,
  }),
  define({
    key: 'integrations.githubWebhookSecret',
    scope: 'install',
    group: 'integrations',
    kind: 'secret',
    envVar: 'GITHUB_WEBHOOK_SECRET',
    secret: true,
    label: 'GitHub webhook secret',
    help: 'Paste the same secret into the GitHub webhook so Lupin can prove each event came from GitHub.',
    apply: 'live',
    schema: longSecret,
  }),
  define({
    key: 'integrations.healthWebhookSecret',
    scope: 'install',
    group: 'integrations',
    kind: 'secret',
    envVar: 'HEALTH_WEBHOOK_SECRET',
    secret: true,
    label: 'Health alert signing secret',
    help: 'Signs repository-health webhook alerts so the receiver can trust them. Empty means none are sent.',
    apply: 'live',
    schema: longSecret,
  }),
  define({
    key: 'integrations.slackBotToken',
    scope: 'install',
    group: 'integrations',
    kind: 'secret',
    envVar: 'SLACK_BOT_TOKEN',
    secret: true,
    label: 'Slack bot token',
    help: 'A bot token (xoxb-…) used for repository-health alerts. Empty means Slack alerts are off.',
    apply: 'live',
    schema: secretValue,
  }),
  define({
    key: 'integrations.deliverySyncIntervalMs',
    scope: 'install',
    group: 'integrations',
    kind: 'integer',
    envVar: 'DELIVERY_SYNC_INTERVAL_MS',
    secret: false,
    label: 'Delivery sync interval',
    help: 'How often pull requests and deploys are refreshed. Shorter is fresher but uses more API quota.',
    apply: 'live',
    unit: 'ms',
    defaultValue: 60_000,
    schema: z.coerce.number().int().min(10_000, 'Use at least 10000 ms').max(86_400_000),
  }),
  // Sessions and retention
  define({
    key: 'sessions.ttlHours',
    scope: 'install',
    group: 'sessions-retention',
    kind: 'integer',
    envVar: 'SESSION_TTL_HOURS',
    secret: false,
    label: 'Sign-in lasts',
    help: 'How long someone stays signed in before they must sign in again.',
    apply: 'next-sign-in',
    unit: 'hours',
    defaultValue: 24,
    schema: positive(24 * 90),
  }),
  define({
    key: 'retention.sessionDays',
    scope: 'install',
    group: 'sessions-retention',
    kind: 'integer',
    envVar: 'SESSION_RETENTION_DAYS',
    secret: false,
    label: 'Keep expired sessions for',
    help: 'Expired sign-in records older than this are deleted.',
    apply: 'live',
    unit: 'days',
    defaultValue: 30,
    schema: positive(3_650),
  }),
  define({
    key: 'retention.sseReplayHours',
    scope: 'install',
    group: 'sessions-retention',
    kind: 'integer',
    envVar: 'SSE_REPLAY_RETENTION_HOURS',
    secret: false,
    label: 'Keep live-event replay for',
    help: 'How far back a reconnecting browser can catch up on live events it missed.',
    apply: 'live',
    unit: 'hours',
    defaultValue: 24,
    schema: positive(24 * 30),
  }),
  define({
    key: 'retention.auditDays',
    scope: 'install',
    group: 'sessions-retention',
    kind: 'integer',
    envVar: 'AUDIT_RETENTION_DAYS',
    secret: false,
    label: 'Keep the audit log for',
    help: 'Audit entries older than this are deleted. Check your compliance policy before shortening it.',
    apply: 'live',
    unit: 'days',
    defaultValue: 365,
    schema: positive(3_650),
  }),
  define({
    key: 'retention.sweepIntervalSeconds',
    scope: 'install',
    group: 'sessions-retention',
    kind: 'integer',
    envVar: 'RETENTION_SWEEP_INTERVAL_SECONDS',
    secret: false,
    label: 'Clean up every',
    help: 'How often old records are deleted.',
    apply: 'live',
    unit: 'seconds',
    defaultValue: 3_600,
    schema: positive(86_400),
  }),
  // Identity
  define({
    key: 'identity.oidcIssuer',
    scope: 'install',
    group: 'identity',
    kind: 'url',
    envVar: 'OIDC_ISSUER',
    secret: false,
    label: 'Sign-in provider (issuer)',
    help: 'The issuer address of your identity provider, e.g. https://acme.okta.com.',
    apply: 'next-sign-in',
    schema: httpsUrl,
  }),
  define({
    key: 'identity.oidcClientId',
    scope: 'install',
    group: 'identity',
    kind: 'text',
    envVar: 'OIDC_CLIENT_ID',
    secret: false,
    label: 'Client ID',
    help: 'The client ID your identity provider gave this app.',
    apply: 'next-sign-in',
    schema: z.string().trim().min(1).max(400),
  }),
  define({
    key: 'identity.oidcClientSecret',
    scope: 'install',
    group: 'identity',
    kind: 'secret',
    envVar: 'OIDC_CLIENT_SECRET',
    secret: true,
    label: 'Client secret',
    help: 'The client secret from your identity provider. Stored encrypted.',
    apply: 'next-sign-in',
    schema: secretValue,
  }),
  define({
    key: 'identity.oidcAllowedDomains',
    scope: 'install',
    group: 'identity',
    kind: 'text',
    envVar: 'OIDC_ALLOWED_DOMAINS',
    secret: false,
    label: 'Allowed email domains',
    help: 'Comma-separated, e.g. acme.com. Empty lets anyone your provider vouches for sign in.',
    apply: 'next-sign-in',
    schema: z
      .string()
      .trim()
      .max(2_000)
      .refine(
        (value) => splitSettingList(value).every((domain) => DOMAIN.test(domain)),
        'List domains like acme.com, separated by commas',
      ),
  }),
  define({
    key: 'identity.oidcRoleMap',
    scope: 'install',
    group: 'identity',
    kind: 'text',
    envVar: 'OIDC_ROLE_MAP',
    secret: false,
    label: 'Role rules',
    help: 'Who gets which role, as role:who, e.g. admin:alice@acme.com. Tested before it is saved.',
    apply: 'next-sign-in',
    schema: roleMap,
  }),
  define({
    key: 'identity.oidcDefaultRole',
    scope: 'install',
    group: 'identity',
    kind: 'role',
    envVar: 'OIDC_DEFAULT_ROLE',
    secret: false,
    label: 'Role for everyone else',
    help: 'The role of someone no rule names. Choose none to admit only the people you listed.',
    apply: 'next-sign-in',
    defaultValue: 'viewer',
    schema: roleOrNone,
  }),
  define({
    key: 'identity.cfAccessRoleMap',
    scope: 'install',
    group: 'identity',
    kind: 'text',
    envVar: 'CF_ACCESS_ROLE_MAP',
    secret: false,
    label: 'Cloudflare Access role rules',
    help: 'The same role:who rules, for people arriving through Cloudflare Access.',
    apply: 'next-sign-in',
    schema: roleMap,
  }),
  define({
    key: 'identity.cfAccessDefaultRole',
    scope: 'install',
    group: 'identity',
    kind: 'role',
    envVar: 'CF_ACCESS_DEFAULT_ROLE',
    secret: false,
    label: 'Cloudflare Access role for everyone else',
    help: 'The role of a Cloudflare Access identity no rule names.',
    apply: 'next-sign-in',
    defaultValue: 'viewer',
    schema: roleOrNone,
  }),
  define({
    key: 'identity.ssoEnforced',
    scope: 'install',
    group: 'identity',
    kind: 'boolean',
    envVar: 'AUTH_SSO_ENFORCED',
    secret: false,
    label: 'Require single sign-on',
    help: 'When on, people can only sign in through your provider. Test sign-in first.',
    apply: 'next-sign-in',
    defaultValue: false,
    schema: z.boolean(),
  }),
];

/** Groups whose writes must pass a test sign-in first, and the lockout guard. */
export const VERIFIED_GROUPS: ReadonlySet<SettingGroup> = new Set(['identity']);

/**
 * Environment variables that are deliberately **not** settings: read before the app can
 * serve, or able to change who can reach it. Every variable `@lupin/config` reads is either
 * in {@link SETTINGS} or here; `settings.test.ts` checks both directions.
 */
export const INFRA_ENV_ALLOW_LIST: readonly string[] = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'DATABASE_URL',
  'COOKIE_SECRET',
  'SESSION_SECRET',
  'VAULT_SECRET',
  'PUBLIC_APP_URL',
  'WORKSPACE_ID',
  'LUPIN_API_KEY',
  'REPORTER_SECRET',
  'RUNNER_REGISTRATION_SECRET',
  'ARTIFACT_ROOT',
  'WORKER_POLL_INTERVAL_MS',
  'WORKER_LEASE_MS',
  'WORKER_LEASE_DURATION_MS',
  'WORKER_MAX_ATTEMPTS',
  'TRUST_PROXY',
  'ACCESS_CONTROL',
  'LUPIN_PROFILE',
  'LUPIN_REMOTE',
  'CF_ACCESS_TEAM_DOMAIN',
  'CF_ACCESS_AUD',
  'LUPIN_BREAK_GLASS',
  'LUPIN_LAN_MODE',
  'LUPIN_BIND',
  'ALLOWED_CLIENT_CIDRS',
  // Replaced by "Connect a repository"; kept for installs that register a folder at boot.
  'LUPIN_PROJECT_ROOT',
];

export function settingByKey(key: string): SettingDefinition | undefined {
  return SETTINGS.find((setting) => setting.key === key);
}

// Read model and request bodies

export const SETTING_SOURCES = ['environment', 'ui', 'default', 'unset'] as const;
export type SettingSource = (typeof SETTING_SOURCES)[number];

export const SettingValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const SettingReadSchema = z.object({
  key: z.string(),
  source: z.enum(SETTING_SOURCES),
  /** Never set for a secret. */
  value: SettingValueSchema,
  /** Secrets only: whether one is stored, and its last four characters. */
  secret: z.object({ set: z.boolean(), last4: z.string().nullable() }).optional(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type SettingRead = z.infer<typeof SettingReadSchema>;

export const SettingsListSchema = z.object({ settings: z.array(SettingReadSchema) });

export const PutSettingBodySchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const SettingTestResultSchema = z.object({
  ok: z.boolean(),
  /** One sentence for the person: what happened, or what to change. */
  message: z.string(),
});
export type SettingTestResult = z.infer<typeof SettingTestResultSchema>;

/** Error codes the settings and onboarding routes answer with, each with the fix a person reads. */
export const SETTINGS_ERROR_FIXES = {
  ENV_LOCKED: 'Remove the environment variable and restart the API, or change it there instead.',
  INVALID_SETTING: 'Correct the highlighted value and save again.',
  UNKNOWN_SETTING: 'Reload the page; this setting no longer exists.',
  TEST_FAILED: 'Check the address and credentials, then press Test again.',
  NOT_VERIFIED: 'Press "Test sign-in" and complete it before saving.',
  WOULD_LOCK_OUT: 'Add a rule that keeps you an admin, then test sign-in again.',
  INSTALLATION_ADMIN_REQUIRED: 'Ask an installation admin to change this setting.',
  VAULT_NOT_CONFIGURED: 'Set VAULT_SECRET on the API and restart it, then save the secret again.',
} as const;
export type SettingsErrorCode = keyof typeof SETTINGS_ERROR_FIXES;

// Onboarding

export const ONBOARDING_STEPS = [
  'workspace',
  'repository',
  'ai',
  'notifications',
  'teammates',
  'first-run',
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export const OnboardingStepSchema = z.object({
  id: z.enum(ONBOARDING_STEPS),
  state: z.enum(['done', 'todo', 'skipped']),
  /** The least role that can finish it, so a viewer is told whom to ask. */
  who: z.enum(['viewer', 'operator', 'admin']),
  title: z.string(),
  href: z.string(),
});
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

export const OnboardingSchema = z.object({
  steps: z.array(OnboardingStepSchema),
  done: z.number().int(),
  total: z.number().int(),
  dismissed: z.boolean(),
});
export type Onboarding = z.infer<typeof OnboardingSchema>;
