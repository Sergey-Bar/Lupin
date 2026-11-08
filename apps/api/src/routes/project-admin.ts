import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { projects } from '@lupin/db';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { audit } from '../services/access-service.js';
import { deleteGitToken, hasGitToken, storeGitToken } from '../services/git-credential-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';

/**
 * Managing a registered project from Settings → Projects: rename it, change its default
 * branch, replace or remove its git token, and delete it.
 *
 * Who may do what:
 *  - operator: rename, change the branch, see whether a token is stored;
 *  - admin: replace or remove the token (a credential), and delete the project (its history).
 *
 * Every read and write is constrained on the workspace, so another workspace's project is a
 * 404 rather than a 403: its existence is not disclosed.
 */
export interface ProjectAdminRouteOptions {
  db: ProjectRegistryServiceOptions['db'];
  workspaceId: string;
  vaultSecret: string | undefined;
  access: CallerResolver;
}

export const UpdateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Give the project a name').max(200).optional(),
    defaultBranch: z.string().trim().min(1).max(255).optional(),
  })
  .refine((body) => body.name !== undefined || body.defaultBranch !== undefined, {
    message: 'Send a name or a defaultBranch to change',
  });

const GitTokenBodySchema = z.object({ token: z.string().trim().min(1).max(4_000) });
const DeleteBodySchema = z.object({ confirm: z.string() });

async function body(context: Context): Promise<unknown> {
  return context.req.json().catch(() => null);
}

function invalid(issues: unknown, fix: string): DomainError {
  return new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid request', {
    details: { issues, fix },
  });
}

export function createProjectAdminRoutes(options: ProjectAdminRouteOptions): Hono {
  const app = new Hono();
  const operator = requireRole('operator', options.access);
  const admin = requireRole('admin', options.access);
  const vault = (actor?: string) => ({
    db: options.db,
    workspaceId: options.workspaceId,
    vaultSecret: options.vaultSecret,
    ...(actor === undefined ? {} : { actor }),
  });

  async function owned(projectId: string) {
    const [row] = /^[0-9a-f-]{36}$/iu.test(projectId)
      ? await options.db
          .select()
          .from(projects)
          .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, projectId)))
          .limit(1)
      : [];
    if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, 'No such project');
    return row;
  }

  const actor = async (context: Context) => (await callerOf(context, options.access)).actor;

  app.patch('/api/v1/projects/:id', operator, async (context) => {
    const row = await owned(context.req.param('id'));
    const parsed = UpdateProjectBodySchema.safeParse(await body(context));
    if (!parsed.success) throw invalid(parsed.error.issues, 'Send a non-empty name or branch.');
    await options.db
      .update(projects)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, row.id)));
    await audit(options, {
      actor: await actor(context),
      action: 'project.update',
      resourceType: 'project',
      resourceId: row.id,
      details: { fields: Object.keys(parsed.data) },
    });
    const updated = await owned(row.id);
    return context.json({
      project: { id: updated.id, name: updated.name, defaultBranch: updated.defaultBranch },
    });
  });

  app.delete('/api/v1/projects/:id', admin, async (context) => {
    const row = await owned(context.req.param('id'));
    const parsed = DeleteBodySchema.safeParse(await body(context));
    if (!parsed.success || parsed.data.confirm !== row.name) {
      throw invalid(
        parsed.success ? [] : parsed.error.issues,
        `Type the project name, ${row.name}, to confirm.`,
      );
    }
    try {
      await options.db
        .delete(projects)
        .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, row.id)));
    } catch {
      // A `restrict` key (a run still leased against the project) refuses the delete.
      throw new DomainError(ErrorCode.CONFLICT, 'This project still has runs that must be kept.', {
        details: { fix: 'Wait for its running jobs to finish, then delete it again.' },
      });
    }
    await deleteGitToken(vault(await actor(context)), row.id);
    await audit(options, {
      actor: await actor(context),
      action: 'project.delete',
      resourceType: 'project',
      resourceId: row.id,
      details: { name: row.name },
    });
    return context.json({ ok: true });
  });

  app.get('/api/v1/projects/:id/git-token', operator, async (context) => {
    const row = await owned(context.req.param('id'));
    return context.json({ set: await hasGitToken(vault(), row.id) });
  });

  app.put('/api/v1/projects/:id/git-token', admin, async (context) => {
    const row = await owned(context.req.param('id'));
    const parsed = GitTokenBodySchema.safeParse(await body(context));
    if (!parsed.success) throw invalid(parsed.error.issues, 'Paste the access token.');
    await storeGitToken(vault(await actor(context)), row.id, parsed.data.token);
    return context.json({ set: true });
  });

  app.delete('/api/v1/projects/:id/git-token', admin, async (context) => {
    const row = await owned(context.req.param('id'));
    await deleteGitToken(vault(await actor(context)), row.id);
    return context.json({ set: false });
  });

  return app;
}
