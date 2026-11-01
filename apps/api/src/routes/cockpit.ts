import { Hono } from 'hono';
import { z } from 'zod/v4';
import { renderCockpitHtml } from '@lupin/reporting';
import { CockpitWindowSchema } from '@lupin/shared-contracts';
import { invalidRequest } from '../http/invalid-request.js';
import { requireRole, type CallerResolver } from '../http/roles.js';
import { cockpit, type CockpitOptions } from '../services/cockpit-service.js';

/**
 * The cockpit: whether the product is better or worse than it was, and why. Read-only, for any
 * viewer. It names pull requests, runs and commits, never a person: no author login, email or
 * name is read by the service that builds it.
 */
export interface CockpitRouteOptions extends CockpitOptions {
  access: CallerResolver;
}

const CockpitQuerySchema = z.object({
  /** Omitted: the project with the most recent health reading. */
  projectId: z.string().trim().min(1).max(64).optional(),
  branch: z.string().trim().min(1).max(255).optional(),
  window: CockpitWindowSchema.default('7d'),
});

const ReportQuerySchema = z.object({
  branch: z.string().trim().min(1).max(255).optional(),
  window: CockpitWindowSchema.default('7d'),
  /** `1`: offer the page as a file to save, rather than show it. */
  download: z.enum(['0', '1']).optional(),
});

export function createCockpitRoutes(options: CockpitRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);

  app.get('/api/v1/cockpit', viewer, async (context) => {
    const parsed = CockpitQuerySchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid cockpit query', parsed.error.issues);
    return context.json(await cockpit(options, parsed.data));
  });

  // The same cockpit as one page that fetches nothing, to attach or to publish as a CI artifact.
  app.get('/api/v1/projects/:id/cockpit/report.html', viewer, async (context) => {
    const parsed = ReportQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      return invalidRequest(context, 'Invalid cockpit report query', parsed.error.issues);
    }
    const reading = await cockpit(options, {
      projectId: context.req.param('id'),
      branch: parsed.data.branch,
      window: parsed.data.window,
    });
    // The page carries its own policy in a <meta>; this one says it before the page is parsed,
    // and `frame-ancestors` can only be said here. A report is private to whoever asked, so it
    // is not stored by anything between the server and the reader.
    context.header('content-security-policy', REPORT_POLICY);
    context.header('x-content-type-options', 'nosniff');
    context.header('referrer-policy', 'no-referrer');
    context.header('cache-control', 'no-store');
    if (parsed.data.download === '1') {
      context.header('content-disposition', `attachment; filename="${fileNameOf(reading)}"`);
    }
    return context.html(renderCockpitHtml(reading));
  });

  return app;
}

const REPORT_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** `lupin-cockpit-<project>-<day>.html`, with only letters, digits and hyphens from the project. */
function fileNameOf(reading: { projectName: string; generatedAt: string }): string {
  const project =
    reading.projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 40) || 'project';
  return `lupin-cockpit-${project}-${reading.generatedAt.slice(0, 10)}.html`;
}
