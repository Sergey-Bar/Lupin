import { QualityPulseSchema, type QualityPulse } from '@lupin/shared-contracts';
import { parse } from './qa-client.js';

/**
 * Whether a project's quality got better or worse over the last `days`, against the `days`
 * before (plan 1795712849115 task 15), parsed against the server's own schema.
 */
export async function getPulse(
  projectId: string,
  days: number,
  fetcher: typeof fetch = fetch,
): Promise<QualityPulse> {
  const path = `/api/v1/projects/${encodeURIComponent(projectId)}/pulse?days=${String(days)}`;
  const response = await fetcher(path, { credentials: 'same-origin' });
  return parse(response, QualityPulseSchema, path);
}
