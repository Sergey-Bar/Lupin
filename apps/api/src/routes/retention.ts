import { Hono } from 'hono';
import { z } from 'zod/v4';
import { invalidRequest } from '../http/invalid-request.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';
import { MAX_RETENTION_DAYS, readRetention, setRetention } from '../services/retention-service.js';

/**
 * The workspace's run retention (plan task 14). An admin sets it, because the sweep it turns on
 * deletes runs; a viewer reads it, so a team knows how far back its history goes.
 */
const RetentionBodySchema = z
  .object({ runDays: z.number().int().min(1).max(MAX_RETENTION_DAYS).nullable() })
  .strict();

export function createRetentionRoutes(
  options: Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'> & { access: CallerResolver },
): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);
  const admin = requireRole('admin', options.access);

  app.get('/api/v1/retention', viewer, async (context) =>
    context.json(await readRetention(options)),
  );

  app.put('/api/v1/retention', admin, async (context) => {
    const parsed = RetentionBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return invalidRequest(context, 'Invalid retention', parsed.error.issues);
    }
    const actor = (await callerOf(context, options.access)).actor;
    return context.json(await setRetention(options, parsed.data.runDays, actor));
  });

  return app;
}
