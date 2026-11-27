import { SelfChecksSchema, type SelfChecks } from '@lupin/shared-contracts';
import { parse } from './qa-client.js';

/** What the install noticed about itself, parsed against the server's own schema. */
export async function getSelfChecks(fetcher: typeof fetch = fetch): Promise<SelfChecks> {
  const path = '/api/v1/self-checks';
  const response = await fetcher(path, { credentials: 'same-origin' });
  return parse(response, SelfChecksSchema, path);
}
