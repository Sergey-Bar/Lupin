import { z } from 'zod/v4';
import { parse } from './qa-client.js';

/**
 * The copilot, from the browser. The answer is parsed against the shape the API's rule engine
 * returns, so a citation the page renders as a link is always one the server named.
 */
const CitationSchema = z.object({
  kind: z.enum(['run', 'test']),
  id: z.string(),
  runId: z.string().optional(),
});

const ProposedActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('retry'),
    runId: z.string(),
    scope: z.enum(['failed', 'all']),
    label: z.string(),
  }),
  z.object({
    kind: z.literal('quarantine'),
    testId: z.string(),
    testTitle: z.string(),
    testFile: z.string(),
    runId: z.string(),
    label: z.string(),
  }),
]);

export const RunExplanationSchema = z.object({
  runId: z.string(),
  source: z.literal('rules'),
  summary: z.string(),
  causes: z.array(z.object({ message: z.string(), count: z.number(), tests: z.array(z.string()) })),
  citations: z.array(CitationSchema),
  actions: z.array(ProposedActionSchema),
});

export type RunExplanation = z.infer<typeof RunExplanationSchema>;
export type CopilotAction = z.infer<typeof ProposedActionSchema>;

export interface CopilotClient {
  explainRun(runId: string): Promise<RunExplanation>;
}

export function createCopilotClient(baseUrl = '', fetchImpl: typeof fetch = fetch): CopilotClient {
  return {
    explainRun: async (runId) => {
      const path = '/api/v1/copilot/explain';
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      return parse(response, RunExplanationSchema, path);
    },
  };
}
