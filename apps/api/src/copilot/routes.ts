import { Hono } from 'hono';
import { z } from 'zod';
import { DomainError } from '../errors/domain-error.js';
import type { ExecutionStore } from '../execution/types.js';
import { explainRun } from './explain.js';
import { answerQuestion } from './ask.js';

const ExplainBodySchema = z.object({ runId: z.string().min(1).max(200) });
const AskBodySchema = z.object({ question: z.string().trim().min(1).max(500) });
/** How many recent runs a question is answered from. */
const ASK_RUNS = 50;

/**
 * The copilot's read side. `explain` answers from the run alone, through the rule engine,
 * so every number in it is counted and every test it names is cited. A run in another
 * workspace is the same 404 as a missing one: the store is asked with the caller's
 * workspace and never without it.
 */
export function createCopilotRoutes(options: { store: ExecutionStore; workspaceId: string }): Hono {
  const app = new Hono();
  app.post('/api/v1/copilot/explain', async (context) => {
    const parsed = ExplainBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Body needs a runId');
    const run = await options.store.getRun(parsed.data.runId, options.workspaceId);
    if (!run) throw new DomainError('RUN_NOT_FOUND', 'Run not found');
    return context.json({ runId: run.id, ...explainRun(run) });
  });
  app.post('/api/v1/copilot/ask', async (context) => {
    const parsed = AskBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Body needs a question');
    // The newest page of this workspace's runs is the whole of the evidence.
    const page = await options.store.listRuns(options.workspaceId, undefined, { limit: ASK_RUNS });
    return context.json(answerQuestion(parsed.data.question, page.runs));
  });
  return app;
}
