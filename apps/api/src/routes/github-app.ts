import { Hono, type Context } from 'hono';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { audit } from '../services/access-service.js';
import {
  deleteGitHubApp,
  GitHubAppBodySchema,
  hasGitHubApp,
  storeGitHubApp,
} from '../services/github-app-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';

/**
 * Settings → Integrations → GitHub App: whether one is configured, and an admin's store and
 * remove. The key goes into the vault and is never returned, not even to an admin; the answer
 * is only `{ set }`.
 */
export interface GitHubAppRouteOptions {
  db: ProjectRegistryServiceOptions['db'];
  workspaceId: string;
  vaultSecret: string | undefined;
  access: CallerResolver;
}

export function createGitHubAppRoutes(options: GitHubAppRouteOptions): Hono {
  const app = new Hono();
  const operator = requireRole('operator', options.access);
  const admin = requireRole('admin', options.access);
  const vault = (actor?: string) => ({
    db: options.db,
    workspaceId: options.workspaceId,
    vaultSecret: options.vaultSecret,
    ...(actor === undefined ? {} : { actor }),
  });
  const actor = async (context: Context) => (await callerOf(context, options.access)).actor;

  app.get('/api/v1/settings/github-app', operator, async (context) =>
    context.json({ set: await hasGitHubApp(vault()) }),
  );

  app.put('/api/v1/settings/github-app', admin, async (context) => {
    const parsed = GitHubAppBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid GitHub App', {
        details: { issues: parsed.error.issues, fix: 'Send the App ID and the private key.' },
      });
    }
    const who = await actor(context);
    await storeGitHubApp(vault(who), parsed.data);
    await audit(options, {
      actor: who,
      action: 'github_app.store',
      resourceType: 'integration',
      resourceId: 'github-app',
      details: { appId: parsed.data.appId },
    });
    return context.json({ set: true });
  });

  app.delete('/api/v1/settings/github-app', admin, async (context) => {
    await deleteGitHubApp(vault(await actor(context)));
    return context.json({ set: false });
  });

  return app;
}
