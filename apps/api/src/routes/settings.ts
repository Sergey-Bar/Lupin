import { Hono, type Context } from 'hono';
import {
  PutSettingBodySchema,
  SETTINGS,
  SETTINGS_ERROR_FIXES,
  VERIFIED_GROUPS,
  settingByKey,
  type SettingDefinition,
  type SettingTestResult,
} from '@lupin/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import {
  callerOf,
  isInstallationAdmin,
  requireRole,
  sourceOf,
  type CallerResolver,
} from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import type { SettingValue, SettingsService } from '../services/settings-service.js';

/**
 * Checks a draft before anyone saves it: "can Lupin reach this gateway with this key?".
 *
 * Keyed by setting key or by group; a key's own tester wins. It receives every setting of the
 * group as currently in effect, with the draft written over its own key, so testing a new API
 * key uses the saved gateway address and the other way round.
 */
export type SettingTester = (
  values: Record<string, SettingValue | undefined>,
) => Promise<SettingTestResult>;
export type SettingTesters = Partial<Record<string, SettingTester>>;

export interface SettingsRouteOptions {
  access: CallerResolver;
  settings: SettingsService;
  testers: SettingTesters;
  /**
   * Whether this composition is the installation's home workspace. While single sign-on is
   * enforced the installation key stops counting, so an admin of the home workspace who signed
   * in through the provider is who can still change installation settings — otherwise turning
   * SSO on would leave nobody able to turn it off.
   */
  home?: boolean;
}

/**
 * Whether `caller` may change installation-wide settings: an installation admin, or — only
 * while single sign-on is enforced — an admin of the home workspace signed in through it.
 */
export function mayChangeInstallation(
  caller: Caller,
  access: CallerResolver,
  home: boolean,
): boolean {
  if (isInstallationAdmin(caller)) return true;
  return (
    home && access.ssoEnforced === true && caller.role === 'admin' && sourceOf(caller) === 'user'
  );
}

async function valueOf(context: Context): Promise<SettingValue> {
  const parsed = PutSettingBodySchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Send { "value": … }.', {
      details: { issues: parsed.error.issues, fix: SETTINGS_ERROR_FIXES.INVALID_SETTING },
    });
  }
  return parsed.data.value;
}

/**
 * Installation settings. Every route is admin; a write to an installation-scoped key also
 * needs an **installation** admin, because a workspace admin changing the AI gateway or the
 * sign-in provider would be changing every other tenant's install.
 */
export function createSettingsRoutes(options: SettingsRouteOptions): Hono {
  const app = new Hono();
  const admin = requireRole('admin', options.access);

  async function writer(context: Context, key: string): Promise<string> {
    const caller = await callerOf(context, options.access);
    const definition = settingByKey(key);
    if (
      definition?.scope === 'install' &&
      !mayChangeInstallation(caller, options.access, options.home ?? true)
    ) {
      throw new DomainError(
        ErrorCode.INSTALLATION_ADMIN_REQUIRED,
        'Only an installation admin can change this setting.',
        { details: { key, fix: SETTINGS_ERROR_FIXES.INSTALLATION_ADMIN_REQUIRED } },
      );
    }
    return caller.actor;
  }

  /** A sign-in setting is written only through the draft → test sign-in → apply flow. */
  function refuseUnverified(key: string): void {
    const definition = settingByKey(key);
    if (definition !== undefined && VERIFIED_GROUPS.has(definition.group)) {
      throw new DomainError(
        ErrorCode.NOT_VERIFIED,
        'Sign-in settings are saved together, after a test sign-in.',
        {
          details: {
            key,
            fix: 'Open Settings → Identity, save your changes, and press Test sign-in.',
          },
        },
      );
    }
  }

  app.get('/api/v1/settings', admin, async (context) => {
    const scope = context.req.query('scope');
    return context.json({
      settings: await options.settings.list(
        scope === 'install' || scope === 'workspace' ? scope : undefined,
      ),
    });
  });

  app.put('/api/v1/settings/:key', admin, async (context) => {
    const key = context.req.param('key');
    const actor = await writer(context, key);
    refuseUnverified(key);
    return context.json(await options.settings.put(key, await valueOf(context), actor));
  });

  app.delete('/api/v1/settings/:key', admin, async (context) => {
    const key = context.req.param('key');
    const actor = await writer(context, key);
    refuseUnverified(key);
    return context.json(await options.settings.revert(key, actor));
  });

  app.post('/api/v1/settings/:key/test', admin, async (context) => {
    const key = context.req.param('key');
    await writer(context, key);
    const definition = settingByKey(key);
    if (definition === undefined) {
      throw new DomainError(ErrorCode.UNKNOWN_SETTING, `There is no setting called ${key}.`, {
        details: { key, fix: SETTINGS_ERROR_FIXES.UNKNOWN_SETTING },
      });
    }
    const value = await valueOf(context);
    // An empty draft means "test what is in effect": the person changed nothing in this field.
    const useCurrent = value === '';
    const parsed = definition.schema.safeParse(value);
    if (!useCurrent && !parsed.success) {
      return context.json({
        ok: false,
        message: parsed.error.issues[0]?.message ?? `${definition.label} is not valid.`,
      } satisfies SettingTestResult);
    }
    const draft = useCurrent || !parsed.success ? undefined : (parsed.data as SettingValue);
    const values = await testValues(options.settings, definition, draft);
    return context.json(
      await runTester(options.testers[key] ?? options.testers[definition.group], values),
    );
  });

  return app;
}

/**
 * Every setting of the group as it is in effect, with the draft written over its own key. A
 * stored secret goes only where it is already sent: testing a new address would otherwise hand
 * the saved key to whatever host was typed in, which is exactly what showing only its last
 * four characters is meant to prevent.
 */
async function testValues(
  settings: SettingsService,
  definition: SettingDefinition,
  draft: SettingValue | undefined,
): Promise<Record<string, SettingValue | undefined>> {
  const group = SETTINGS.filter((candidate) => candidate.group === definition.group);
  const values: Record<string, SettingValue | undefined> = {};
  for (const setting of group) values[setting.key] = await settings.resolve(setting.key);
  if (draft === undefined) return values;
  if (!definition.secret && draft !== values[definition.key]) {
    for (const setting of group) if (setting.secret) values[setting.key] = undefined;
  }
  values[definition.key] = draft;
  return values;
}

/** The tester's answer, or one sentence when it throws; a setting with no tester is valid. */
async function runTester(
  tester: SettingTester | undefined,
  values: Record<string, SettingValue | undefined>,
): Promise<SettingTestResult> {
  if (tester === undefined) return { ok: true, message: 'The value is valid.' };
  try {
    return await tester(values);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Could not connect: ${reason}. ${SETTINGS_ERROR_FIXES.TEST_FAILED}`,
    };
  }
}
