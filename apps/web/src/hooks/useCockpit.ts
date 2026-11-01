import type { Cockpit } from '@lupin/shared-contracts';
import type { CockpitClient, CockpitQuery } from '../lib/cockpit-client.js';
import { useResource, type Resource } from './useResource.js';

/**
 * The cockpit for one query, with the loading, ready and error states every screen needs.
 *
 * `reload` is a counter the caller bumps to read again: the same query asked a second time
 * is a different read, and the hook cannot tell from the query alone. The previous request
 * is aborted when any of them changes, so a slow answer for the window a person has already
 * left never lands on the one they chose.
 */
export function useCockpit(
  getCockpit: CockpitClient['getCockpit'],
  query: CockpitQuery,
  reload = 0,
): Resource<Cockpit> {
  return useResource(
    (signal) => getCockpit(query, signal),
    [getCockpit, query.window, query.projectId, query.branch, reload],
  );
}
