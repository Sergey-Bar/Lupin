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
  causes: z.array(
    z.object({
      message: z.string(),
      count: z.number(),
      tests: z.array(z.string()),
      /** Optional so an older server's answer still parses. */
      owners: z.array(z.string()).default([]),
    }),
  ),
  citations: z.array(CitationSchema),
  actions: z.array(ProposedActionSchema),
  /** Optional so an older server's answer still parses. */
  narration: z
    .discriminatedUnion('source', [
      z.object({ source: z.literal('model'), model: z.string(), text: z.string() }),
      z.object({ source: z.literal('rules'), text: z.string() }),
    ])
    .optional(),
});

export type RunExplanation = z.infer<typeof RunExplanationSchema>;
export type CopilotAction = z.infer<typeof ProposedActionSchema>;

export const QuestionAnswerSchema = z.object({
  source: z.literal('rules'),
  answer: z.string(),
  citations: z.array(CitationSchema),
  links: z.array(z.object({ label: z.string(), to: z.string().startsWith('/') })),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

export interface CopilotClient {
  explainRun(runId: string): Promise<RunExplanation>;
  ask?(question: string): Promise<QuestionAnswer>;
}

export function createCopilotClient(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Required<CopilotClient> {
  const post = (path: string, body: unknown) =>
    fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return {
    explainRun: async (runId) => {
      const path = '/api/v1/copilot/explain';
      return parse(await post(path, { runId }), RunExplanationSchema, path);
    },
    ask: async (question) => {
      const path = '/api/v1/copilot/ask';
      return parse(await post(path, { question }), QuestionAnswerSchema, path);
    },
  };
}
