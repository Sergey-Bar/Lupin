import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ConnectorAdapter } from '@lupin/connectors-sdk';
import { GithubActionsBodySchema, GithubInboxQuerySchema } from '@lupin/shared-contracts';
import { domainErrorResponse } from '../errors/boundary.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { invalidRequest } from '../http/invalid-request.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { runGithubActions } from '../services/github-actions-service.js';
import {
  getRepoOverview,
  listIssues,
  listPullRequests,
  listRepos,
  type InboxOptions,
} from '../services/github-inbox-service.js';

/**
 * The GitHub command center's reads: pull requests, issues and repositories across the
 * workspace, from the tables the delivery sync fills. Viewers may read; nothing here calls
 * GitHub, so a read is cheap and never spends the request budget.
 */
export interface GitHubReadRouteOptions extends InboxOptions {
  access: CallerResolver;
}

export function createGitHubReadRoutes(options: GitHubReadRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);

  app.get('/api/v1/github/prs', viewer, async (context) => {
    const parsed = GithubInboxQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return invalidRequest(context, 'Invalid query', parsed.error.issues);
    return context.json(await listPullRequests(options, parsed.data));
  });

  app.get('/api/v1/github/issues', viewer, async (context) => {
    const parsed = GithubInboxQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return invalidRequest(context, 'Invalid query', parsed.error.issues);
    return context.json(await listIssues(options, parsed.data));
  });

  app.get('/api/v1/github/repos', viewer, async (context) =>
    context.json(await listRepos(options)),
  );

  app.get('/api/v1/github/repos/:id', viewer, async (context) =>
    context.json(await getRepoOverview(options, context.req.param('id'))),
  );

  return app;
}

/** 50 actions of up to 64 kB of comment each is the most one request may carry, with room to spare. */
export const GITHUB_ACTIONS_MAX_BYTES = 4 * 1024 * 1024;

export interface GitHubActionRouteOptions extends InboxOptions {
  access: CallerResolver;
  /** Absent: nothing can be written, and every item is refused for want of a token. */
  adapter?: ConnectorAdapter;
  /** The project's GitHub token from the vault, or `null` when there is none. */
  tokenFor: (workspaceId: string, projectId: string) => Promise<string | null>;
}

/** Stands in when no GitHub adapter is configured. Never reached: with no token nothing is sent. */
const NO_ADAPTER: ConnectorAdapter = {
  manifest: { name: 'github', version: '0', operations: {} },
  execute: () =>
    Promise.resolve({
      status: 'error',
      error: { code: 'github_not_configured', retryable: false, message: 'No GitHub adapter' },
      attempts: 0,
    }),
};

/**
 * `POST /api/v1/github/actions`: writes to GitHub, one or many, from the closed set of actions.
 * Operators only. All the decisions are the action service's; this validates the body, names
 * the caller, and answers one result per action.
 */
export function createGitHubActionRoutes(options: GitHubActionRouteOptions): Hono {
  const app = new Hono();
  const operator = requireRole('operator', options.access);

  app.post(
    '/api/v1/github/actions',
    operator,
    bodyLimit({
      maxSize: GITHUB_ACTIONS_MAX_BYTES,
      onError: (context) =>
        domainErrorResponse(
          context,
          new DomainError(ErrorCode.PAYLOAD_TOO_LARGE, 'Body larger than the 4 MB action limit'),
        ),
    }),
    async (context) => {
      const parsed = GithubActionsBodySchema.safeParse(await context.req.json().catch(() => null));
      if (!parsed.success) return invalidRequest(context, 'Invalid actions', parsed.error.issues);
      const { actor } = await callerOf(context, options.access);
      return context.json(
        await runGithubActions(
          {
            db: options.db,
            workspaceId: options.workspaceId,
            adapter: options.adapter ?? NO_ADAPTER,
            tokenFor: options.tokenFor,
            ...(options.now === undefined ? {} : { now: options.now }),
          },
          actor,
          parsed.data,
        ),
      );
    },
  );

  return app;
}
