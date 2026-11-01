import { CockpitSchema, type Cockpit, type CockpitWindow } from '@lupin/shared-contracts';
import { parse } from './qa-client.js';

/**
 * The cockpit data layer.
 *
 * Same two rules as `health-client.ts`: the response is parsed against the server's own
 * contract, and the path is built here, so no screen concatenates a query into a URL.
 */
export interface CockpitQuery {
  window: CockpitWindow;
  /** Omitted: the server shows the project with the most recent health reading. */
  projectId?: string | undefined;
  branch?: string | undefined;
}

export interface CockpitClient {
  getCockpit(query: CockpitQuery, signal?: AbortSignal): Promise<Cockpit>;
}

export function cockpitPath(query: CockpitQuery): string {
  const params = new URLSearchParams({ window: query.window });
  if (query.projectId !== undefined) params.set('projectId', query.projectId);
  if (query.branch !== undefined) params.set('branch', query.branch);
  return `/api/v1/cockpit?${params.toString()}`;
}

export function createCockpitClient(baseUrl = '', fetchImpl: typeof fetch = fetch): CockpitClient {
  return {
    getCockpit: async (query, signal) => {
      const path = cockpitPath(query);
      const response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        method: 'GET',
        ...(signal === undefined ? {} : { signal }),
      });
      return parse(response, CockpitSchema, path);
    },
  };
}
