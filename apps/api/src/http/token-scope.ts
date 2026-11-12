import type { Permission } from '@lupin/shared-contracts';

/**
 * The permission a request needs from a scoped access token (plan task 7).
 *
 * Only a token can carry scopes; a role guard still decides first, so a scope narrows what a
 * role allows and never widens it. The area is the first path segment after `/api/v1/`, and a
 * read is `GET` or `HEAD`.
 */
const AREAS: Readonly<Record<string, 'settings' | 'ai' | 'connectors'>> = {
  'access-tokens': 'settings',
  audit: 'settings',
  features: 'settings',
  members: 'settings',
  onboarding: 'settings',
  'pairing-codes': 'settings',
  'quality-policies': 'settings',
  'report-subscriptions': 'settings',
  'scim-tokens': 'settings',
  schedules: 'settings',
  settings: 'settings',
  'triage-labels': 'settings',
  workspaces: 'settings',
  agents: 'ai',
  automations: 'ai',
  chat: 'ai',
  copilot: 'ai',
  github: 'connectors',
  integrations: 'connectors',
  'notification-channels': 'connectors',
  webhooks: 'connectors',
};

export function permissionForRequest(method: string, path: string): Permission {
  const read = method === 'GET' || method === 'HEAD';
  const segments = path.split('?')[0]?.split('/') ?? [];
  const area = segments[1] === 'api' && segments[2] === 'v1' ? (segments[3] ?? '') : '';
  const kind = AREAS[area];
  if (kind === 'settings') return read ? 'settings:read' : 'settings:write';
  if (kind === 'ai') return read ? 'runs:read' : 'ai:use';
  if (kind === 'connectors') return read ? 'settings:read' : 'connectors:manage';
  if (segments.includes('tests')) return read ? 'tests:read' : 'tests:write';
  return read ? 'runs:read' : 'runs:write';
}

/** Whether a token's scopes admit a request; `null` scopes admit everything its role does. */
export function scopeAdmits(
  scopes: readonly Permission[] | null | undefined,
  method: string,
  path: string,
): boolean {
  if (scopes === null || scopes === undefined) return true;
  return scopes.includes(permissionForRequest(method, path));
}
