import { randomUUID } from 'node:crypto';
import { isLoopbackBind, parseRoleMap, type AccessRole, type OidcConfig } from '@lupin/config';
import { SETTINGS_ERROR_FIXES, settingByKey, splitSettingList } from '@lupin/shared-contracts';
import { roleForIdentity } from '../http/role-map.js';
import type { SettingValue } from './settings-service.js';

/**
 * Sign-in settings, changed from the interface without locking anyone out.
 *
 * A typo in a role map or an issuer is the one settings mistake that removes the ability to
 * fix it, so identity is the one group that is not saved field by field. A person saves a
 * **draft**; an OIDC change must then pass a real sign-in through the provider with the draft
 * configuration ("Test sign-in"), and the draft is applied only if the person who tested it
 * comes back an admin. A Cloudflare Access change cannot be tested that way, so it is accepted
 * only from someone signed in with the installation key, which the change cannot take away.
 */
export const OIDC_KEYS = [
  'identity.oidcIssuer',
  'identity.oidcClientId',
  'identity.oidcClientSecret',
  'identity.oidcAllowedDomains',
  'identity.oidcRoleMap',
  'identity.oidcDefaultRole',
  'identity.ssoEnforced',
] as const;
export const CLOUDFLARE_KEYS = [
  'identity.cfAccessRoleMap',
  'identity.cfAccessDefaultRole',
] as const;

export type IdentityValues = Partial<Record<string, SettingValue | undefined>>;

/** A person a test sign-in returned, and the role the draft gave them. */
export interface VerifiedIdentity {
  email: string;
  groups: readonly string[];
  role: AccessRole | null;
  /**
   * The full configuration the test signed in against, as `fingerprint` writes it. Apply
   * refuses when what is in effect now would produce a different one, so the configuration
   * applied is always the one that was tested.
   */
  basis?: string;
}

/** A stable fingerprint of identity values, for comparing what was tested with what is applied. */
export function fingerprint(values: IdentityValues): string {
  return JSON.stringify(
    Object.keys(values)
      .sort()
      .map((key) => [key, values[key] ?? '']),
  );
}

const text = (value: SettingValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Why one identity value is refused, or `null` when it is fine. */
function identityProblem(key: string, value: SettingValue | undefined): string | null {
  const definition = settingByKey(key);
  if (definition === undefined || definition.group !== 'identity') {
    return `${key} is not a sign-in setting.`;
  }
  if (value === undefined || value === '') return null;
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success)
    return parsed.error.issues[0]?.message ?? `${definition.label} is not valid.`;
  if (!key.endsWith('RoleMap')) return null;
  try {
    parseRoleMap(definition.envVar, String(value));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Every value checked by its registry schema and, for a role map, by the parser sign-in uses. */
export function validateIdentityValues(values: IdentityValues): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const problem = identityProblem(key, value);
    if (problem !== null) problems[key] = problem;
  }
  return problems;
}

/** The OIDC configuration these values describe, or `undefined` while sign-in is off. */
export function oidcConfigFrom(
  values: IdentityValues,
  publicAppUrl: string,
): OidcConfig | undefined {
  const issuer = text(values['identity.oidcIssuer']);
  const clientId = text(values['identity.oidcClientId']);
  if (issuer === undefined || clientId === undefined) return undefined;
  const url = new URL(issuer);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackBind(url.hostname))) {
    throw new Error('The issuer must use https:// (or http:// on this machine only).');
  }
  const clientSecret = text(values['identity.oidcClientSecret']);
  if (clientSecret === undefined) {
    throw new Error('Add the client secret your identity provider gave this app.');
  }
  const role = text(values['identity.oidcDefaultRole']) ?? 'viewer';
  return {
    issuer: issuer.replace(/\/+$/u, ''),
    clientId,
    clientSecret,
    redirectUri: `${publicAppUrl.replace(/\/+$/u, '')}/api/v1/auth/oidc/callback`,
    allowedDomains: splitSettingList(text(values['identity.oidcAllowedDomains']) ?? '').map(
      (domain) => domain.toLowerCase(),
    ),
    roleMap: parseRoleMap('OIDC_ROLE_MAP', text(values['identity.oidcRoleMap'])),
    defaultRole: role === 'none' ? null : (role as AccessRole),
  };
}

/** The role a person would have under `config`, for the test sign-in's verdict. */
export function roleUnderDraft(
  config: OidcConfig | undefined,
  identity: { email: string; groups: readonly string[] },
): AccessRole | null {
  if (config === undefined) return null;
  return roleForIdentity(
    { email: identity.email, groups: identity.groups, serviceTokenId: null },
    config,
  );
}

export interface LockoutInput {
  oidcChanged: boolean;
  cloudflareChanged: boolean;
  /** Single sign-on enforced *after* the change. */
  ssoEnforced: boolean;
  breakGlass: boolean;
  /** Where the person applying the change signed in from (`http/roles.ts` `sourceOf`). */
  callerSource: string;
  verified: VerifiedIdentity | null;
}

/** Why a draft must not be applied, or `null` when it is safe. */
export function lockoutProblem(
  input: LockoutInput,
): { code: 'NOT_VERIFIED' | 'WOULD_LOCK_OUT'; message: string; fix: string } | null {
  if (input.oidcChanged) {
    if (input.verified === null) {
      return {
        code: 'NOT_VERIFIED',
        message: 'Sign-in changes are applied only after a test sign-in with them succeeds.',
        fix: SETTINGS_ERROR_FIXES.NOT_VERIFIED,
      };
    }
    if (input.verified.role !== 'admin') {
      const group = input.verified.groups[0];
      const who = group === undefined ? `you (${input.verified.email})` : `your group \`${group}\``;
      return {
        code: 'WOULD_LOCK_OUT',
        message: `You would lose admin access: ${who} maps to ${input.verified.role ?? 'no role'}.`,
        fix: SETTINGS_ERROR_FIXES.WOULD_LOCK_OUT,
      };
    }
  }
  if (input.ssoEnforced && !input.breakGlass && input.verified?.role !== 'admin') {
    return {
      code: 'NOT_VERIFIED',
      message: 'Requiring single sign-on stops the installation key signing in.',
      fix: 'Test sign-in as an admin first, so there is still a way in.',
    };
  }
  if (input.cloudflareChanged && input.callerSource === 'cloudflare') {
    return {
      code: 'NOT_VERIFIED',
      message: 'Cloudflare Access rules cannot be tested from inside Cloudflare Access.',
      fix: 'Sign in with the installation key to change them, so a mistake cannot lock you out.',
    };
  }
  return null;
}

export interface IdentityDraft {
  id: string;
  values: IdentityValues;
  actor: string;
  expiresAt: number;
  verified: VerifiedIdentity | null;
}

const DRAFT_TTL_MS = 10 * 60_000;

/**
 * Drafts, in process memory. One at a time: a new draft replaces the last, so a verification
 * always belongs to exactly the values that were tested. A restart drops it, which costs one
 * more test sign-in and never applies an untested change.
 */
export function createIdentityDrafts(now: () => number = Date.now) {
  let current: IdentityDraft | undefined;
  const live = (): IdentityDraft | undefined => {
    if (current !== undefined && current.expiresAt <= now()) current = undefined;
    return current;
  };
  return {
    create(values: IdentityValues, actor: string): IdentityDraft {
      current = {
        id: randomUUID(),
        values,
        actor,
        expiresAt: now() + DRAFT_TTL_MS,
        verified: null,
      };
      return current;
    },
    get(id: string): IdentityDraft | undefined {
      const draft = live();
      return draft?.id === id ? draft : undefined;
    },
    verify(id: string, identity: VerifiedIdentity): void {
      const draft = live();
      if (draft?.id === id) draft.verified = identity;
    },
    clear(): void {
      current = undefined;
    },
  };
}
export type IdentityDrafts = ReturnType<typeof createIdentityDrafts>;

/** Whether any of `keys` differs between the draft and what is in effect. */
export function changed(
  keys: readonly string[],
  draft: IdentityValues,
  current: IdentityValues,
): boolean {
  return keys.some((key) => key in draft && (draft[key] ?? '') !== (current[key] ?? ''));
}
