import type { WhoAmI } from './health-client.js';

/**
 * What the signed-in caller may do, as the screens decide what to draw.
 *
 * The API is what enforces access — every write here is behind `requireRole` — so these only
 * decide whether a control is offered. Offering an operator's button to a viewer would be a
 * button that always fails, which reads as a broken product rather than a permission.
 */
export function canOperate(who: Pick<WhoAmI, 'role'>): boolean {
  return who.role === 'operator' || who.role === 'admin';
}

export function canAdminister(who: Pick<WhoAmI, 'role'>): boolean {
  return who.role === 'admin';
}

/** The server's sentence from a thrown client error, or `fallback`. */
export function failureText(error: unknown, fallback: string): string {
  const detail = (error as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/**
 * Whether the caller may change installation-wide settings: an admin whose credential is the
 * installation's own (the installation session, an open install, or Cloudflare Access). The
 * API's `isInstallationAdmin` is the rule; this mirrors it so a workspace admin is told who
 * can change a setting instead of being offered a Save that answers 403.
 */
export function canAdministerInstallation(
  who: Pick<WhoAmI, 'role' | 'source' | 'installationAdmin'>,
): boolean {
  // The API's own answer when it gives one (it also covers single sign-on being enforced).
  if (who.installationAdmin !== undefined) return who.installationAdmin;
  if (who.role !== 'admin') return false;
  // An API older than `source` only had the installation's admin.
  if (who.source === undefined) return true;
  return who.source === 'installation' || who.source === 'anonymous' || who.source === 'cloudflare';
}
