import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod/v4';
import { SETTINGS, SETTINGS_ERROR_FIXES } from '@lupin/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { guard } from '../http/access.js';
import {
  callerOf,
  isInstallationAdmin,
  requireRole,
  sourceOf,
  type CallerResolver,
} from '../http/roles.js';
import {
  CLOUDFLARE_KEYS,
  OIDC_KEYS,
  changed,
  lockoutProblem,
  oidcConfigFrom,
  validateIdentityValues,
  type IdentityDrafts,
  type IdentityValues,
} from '../services/identity-settings.js';
import type { SettingValue, SettingsService } from '../services/settings-service.js';

/**
 * Settings → Identity: draft, test sign-in, apply. See `services/identity-settings.ts` for the
 * rules; this module is the HTTP surface and the one place a sign-in setting is written.
 */
export interface IdentitySettingsRouteOptions {
  access: CallerResolver;
  settings: SettingsService;
  drafts: IdentityDrafts;
  publicAppUrl: string;
  breakGlass: boolean;
}

const IDENTITY_KEYS = SETTINGS.filter((setting) => setting.group === 'identity').map(
  (setting) => setting.key,
);

const DraftBodySchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
const ApplyBodySchema = z.object({ draftId: z.string().min(1) });

/** An admin whose credential is the installation's own; the guard every identity route uses. */
export function installationAdminGuard(access: CallerResolver): MiddlewareHandler {
  const admin = requireRole('admin', access);
  return guard('admin', async (context, next) => {
    await admin(context, async () => {
      if (!isInstallationAdmin(await callerOf(context, access))) {
        throw new DomainError(
          ErrorCode.INSTALLATION_ADMIN_REQUIRED,
          'Only an installation admin can change sign-in settings.',
          { details: { fix: SETTINGS_ERROR_FIXES.INSTALLATION_ADMIN_REQUIRED } },
        );
      }
      await next();
    });
  });
}

/** The identity values in effect now, secrets opened (in process only). */
export async function currentIdentity(settings: SettingsService): Promise<IdentityValues> {
  const values: IdentityValues = {};
  for (const key of IDENTITY_KEYS) values[key] = await settings.resolve(key);
  return values;
}

export function createIdentitySettingsRoutes(options: IdentitySettingsRouteOptions): Hono {
  const app = new Hono();
  const installAdmin = installationAdminGuard(options.access);

  async function body<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
    const parsed = schema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid request', {
        details: { issues: parsed.error.issues, fix: SETTINGS_ERROR_FIXES.INVALID_SETTING },
      });
    }
    return parsed.data;
  }

  app.post('/api/v1/settings/identity/draft', installAdmin, async (context) => {
    const { values } = await body(context, DraftBodySchema);
    const locked = Object.keys(values).filter(
      (key) => IDENTITY_KEYS.includes(key) && options.settings.lockedBy(key) !== null,
    );
    if (locked.length > 0) {
      throw new DomainError(
        ErrorCode.ENV_LOCKED,
        'Some sign-in settings are set by the environment.',
        {
          details: { keys: locked, fix: SETTINGS_ERROR_FIXES.ENV_LOCKED },
        },
      );
    }
    const fields = validateIdentityValues(values);
    const current = await currentIdentity(options.settings);
    const merged = { ...current, ...values };
    try {
      oidcConfigFrom(merged, options.publicAppUrl);
    } catch (error) {
      fields['identity.oidcIssuer'] ??= error instanceof Error ? error.message : String(error);
    }
    if (Object.keys(fields).length > 0) {
      throw new DomainError(
        ErrorCode.INVALID_SETTING,
        Object.values(fields)[0] ?? 'A sign-in setting is not valid.',
        {
          details: { fields, fix: SETTINGS_ERROR_FIXES.INVALID_SETTING },
        },
      );
    }
    const draft = options.drafts.create(values, (await callerOf(context, options.access)).actor);
    const needsTest =
      changed(OIDC_KEYS, values, current) || merged['identity.ssoEnforced'] === true;
    return context.json(
      {
        id: draft.id,
        needsTest,
        testUrl: `/api/v1/auth/oidc/test?draft=${draft.id}`,
        expiresAt: new Date(draft.expiresAt).toISOString(),
      },
      201,
    );
  });

  app.get('/api/v1/settings/identity/draft/:id', installAdmin, async (context) => {
    const draft = options.drafts.get(context.req.param('id'));
    if (draft === undefined) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'This draft has expired.', {
        details: { fix: 'Save the changes again, then test sign-in within ten minutes.' },
      });
    }
    return context.json({
      id: draft.id,
      verified:
        draft.verified === null
          ? null
          : {
              email: draft.verified.email,
              groups: draft.verified.groups,
              role: draft.verified.role,
            },
    });
  });

  app.post('/api/v1/settings/identity/apply', installAdmin, async (context) => {
    const { draftId } = await body(context, ApplyBodySchema);
    const draft = options.drafts.get(draftId);
    if (draft === undefined) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'This draft has expired or was already applied.', {
        details: { fix: 'Save the changes again, then test sign-in within ten minutes.' },
      });
    }
    const caller = await callerOf(context, options.access);
    const current = await currentIdentity(options.settings);
    const merged = { ...current, ...draft.values };
    const problem = lockoutProblem({
      oidcChanged: changed(OIDC_KEYS, draft.values, current),
      cloudflareChanged: changed(CLOUDFLARE_KEYS, draft.values, current),
      ssoEnforced: merged['identity.ssoEnforced'] === true,
      breakGlass: options.breakGlass,
      callerSource: sourceOf(caller),
      verified: draft.verified,
    });
    if (problem !== null) {
      const code =
        problem.code === 'WOULD_LOCK_OUT' ? ErrorCode.WOULD_LOCK_OUT : ErrorCode.NOT_VERIFIED;
      throw new DomainError(code, problem.message, { details: { fix: problem.fix } });
    }
    for (const [key, value] of Object.entries(draft.values)) {
      if (value === '' || value === undefined) await options.settings.revert(key, caller.actor);
      else await options.settings.put(key, value as SettingValue, caller.actor);
    }
    options.drafts.clear();
    return context.json({ settings: await options.settings.list() });
  });

  return app;
}
