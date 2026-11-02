import { and, eq } from 'drizzle-orm';
import { githubIssues, pullRequests } from '@lupin/db';
import type { ConnectorAdapter, ConnectorRequest, ConnectorResult } from '@lupin/connectors-sdk';
import type {
  GithubActionRequest,
  GithubActionResult,
  GithubActionsBody,
  GithubActionsResponse,
} from '@lupin/shared-contracts';
import { audit } from './access-service.js';
import { projectRow, type HealthStoreOptions } from './health-findings.js';
import { protectionFacts } from './github-facts.js';
import { githubRepository } from './health-integrations.js';

/**
 * The one door every write to GitHub goes through.
 *
 * A request is a list of actions from a closed set (`GithubActionRequestSchema`), and each is
 * decided on its own, in this order, before anything is sent:
 *
 *  1. the project must be in the caller's workspace and be a repository on the configured host;
 *  2. the project must have a token in the vault;
 *  3. a merge of something already merged, closed or a draft is refused here, not at GitHub;
 *  4. a dry run stops, and says what it would do.
 *
 * Then the connector is called with the project's token. **A merge names the head commit the
 * person looked at**, and GitHub refuses it if the branch has moved, so a stale screen cannot
 * merge commits nobody reviewed. Every item, done or refused or only planned, is one `audit()`
 * row: who, what, on which target, how it ended. The row carries no token and no text a person
 * wrote, only its length.
 *
 * A rate limit stops the batch: the item that hit it and every item after it report `failed`
 * with the time to come back, and GitHub is not asked again.
 */
export interface ActionsOptions extends HealthStoreOptions {
  adapter: ConnectorAdapter;
  tokenFor: (workspaceId: string, projectId: string) => Promise<string | null>;
  now?: () => Date;
}

interface Resolved {
  owner: string;
  repo: string;
  token: string;
}

/** `owner/repo#12`, or `owner/repo run 99`: what the action is done to. */
function targetOf(
  resolved: { owner: string; repo: string },
  action: GithubActionRequest,
  branch: string,
): string {
  const base = `${resolved.owner}/${resolved.repo}`;
  switch (action.action) {
    case 'rerunWorkflow':
      return `${base} run ${action.runId}`;
    case 'protectBranch':
      return `${base}@${branch}`;
    case 'createRelease':
      return `${base} release ${action.tag}`;
    default:
      return `${base}#${String(action.number)}`;
  }
}

function planOf(action: GithubActionRequest, target: string): string {
  switch (action.action) {
    case 'comment':
      return `Would comment on ${target}.`;
    case 'labels':
      return `Would set ${String(action.labels.length)} label(s) on ${target}.`;
    case 'assign':
      return `Would assign ${String(action.assignees.length)} person(s) to ${target}.`;
    case 'close':
      return `Would close ${target}.`;
    case 'reopen':
      return `Would reopen ${target}.`;
    case 'requestReviewers':
      return `Would ask ${String(action.reviewers.length)} reviewer(s) to review ${target}.`;
    case 'review':
      return `Would submit a ${action.event.toLowerCase().replace('_', ' ')} review on ${target}.`;
    case 'merge':
      return `Would ${action.method}-merge ${target} at ${action.sha.slice(0, 7)}.`;
    case 'updateBranch':
      return `Would bring ${target} up to date with its base branch.`;
    case 'rerunWorkflow':
      return `Would re-run ${target}.`;
    case 'protectBranch':
      return `Would require one approving review on ${target}, unless it is already protected.`;
    case 'createRelease': {
      const kind = action.draft
        ? 'a draft release'
        : action.prerelease
          ? 'a pre-release'
          : 'a release';
      return `Would create ${kind} ${action.tag} on ${target}.`;
    }
  }
}

/** The connector call an action becomes. Numbers are strings: they are path parameters. */
function callOf(action: Exclude<GithubActionRequest, { action: 'protectBranch' }>): {
  operation: string;
  input: Record<string, unknown>;
} {
  const number = 'number' in action ? String(action.number) : '';
  switch (action.action) {
    case 'comment':
      return { operation: 'createIssueComment', input: { number, body: action.body } };
    case 'labels':
      return { operation: 'updateIssue', input: { number, labels: action.labels } };
    case 'assign':
      return { operation: 'updateIssue', input: { number, assignees: action.assignees } };
    case 'close':
      return { operation: 'updateIssue', input: { number, state: 'closed' } };
    case 'reopen':
      return { operation: 'updateIssue', input: { number, state: 'open' } };
    case 'requestReviewers':
      return { operation: 'requestReviewers', input: { number, reviewers: action.reviewers } };
    case 'review':
      return {
        operation: 'createPullRequestReview',
        input: {
          number,
          event: action.event,
          ...(action.body === undefined ? {} : { body: action.body }),
        },
      };
    case 'merge':
      return {
        operation: 'mergePullRequest',
        input: { number, sha: action.sha, merge_method: action.method },
      };
    case 'updateBranch':
      return {
        operation: 'updatePullRequestBranch',
        input: { number, ...(action.sha === undefined ? {} : { expected_head_sha: action.sha }) },
      };
    case 'rerunWorkflow':
      return { operation: 'rerunWorkflow', input: { runId: action.runId } };
    case 'createRelease':
      return {
        operation: 'createRelease',
        input: {
          tag_name: action.tag,
          ...(action.name === undefined ? {} : { name: action.name }),
          ...(action.notes === undefined ? {} : { body: action.notes }),
          draft: action.draft,
          prerelease: action.prerelease,
        },
      };
  }
}

/** The protection Lupin fills a gap with: one approving review, nothing that could lock people out. */
export const BASELINE_PROTECTION = {
  required_status_checks: null,
  enforce_admins: false,
  required_pull_request_reviews: { required_approving_review_count: 1 },
  restrictions: null,
} as const;

/**
 * Protects a default branch that has no protection.
 *
 * GitHub's endpoint *replaces* a branch's rules, so writing blind could weaken a stronger rule a
 * person set by hand. The branch is therefore read first, and only a branch GitHub says is not
 * protected is written. A branch that is protected, or whose protection this token cannot read, is
 * refused and left alone.
 */
async function protectBranch(
  options: ActionsOptions,
  resolved: Resolved,
  branch: string,
  action: GithubActionRequest,
): Promise<{ outcome: GithubActionResult['outcome']; message: string; retryAt?: string }> {
  const target = { owner: resolved.owner, repo: resolved.repo, branch };
  const read = await options.adapter.execute(
    { operation: 'getBranchProtection', input: target },
    resolved.token,
  );
  if (read.status !== 'ok') {
    if (read.error?.code === 'github_rate_limited' && read.error.retryAt !== undefined) {
      return {
        outcome: 'failed',
        message: 'GitHub’s rate limit was reached. Try again later.',
        retryAt: read.error.retryAt,
      };
    }
    return refusalOf(action, read);
  }
  const facts = protectionFacts(read.data);
  if (facts.state === 'protected') {
    return {
      outcome: 'refused',
      message:
        'This branch is already protected. Lupin will not replace its rules; change them on GitHub.',
    };
  }
  if (facts.state === 'unavailable') {
    return {
      outcome: 'refused',
      message: 'Lupin cannot read this branch’s protection, so it will not overwrite it blind.',
    };
  }
  const write = await options.adapter.execute(
    { operation: 'updateBranchProtection', input: { ...target, protection: BASELINE_PROTECTION } },
    resolved.token,
  );
  if (write.status === 'ok') return { outcome: 'ok', message: 'Done.' };
  if (write.error?.code === 'github_rate_limited' && write.error.retryAt !== undefined) {
    return {
      outcome: 'failed',
      message: 'GitHub’s rate limit was reached. Try again later.',
      retryAt: write.error.retryAt,
    };
  }
  return refusalOf(action, write);
}

/** What a person is told when GitHub says no, by what GitHub said. */
function refusalOf(
  action: GithubActionRequest,
  result: ConnectorResult,
): { outcome: 'refused' | 'failed'; message: string } {
  const code = result.error?.code ?? 'github_failed';
  const movesBranch = action.action === 'merge' || action.action === 'updateBranch';
  if (code === 'github_409' && movesBranch) {
    return {
      outcome: 'refused',
      message:
        'The pull request changed after you looked at it. Reload it and review the new commits first.',
    };
  }
  if (code === 'github_405' && action.action === 'merge') {
    return {
      outcome: 'refused',
      message: 'GitHub says this pull request cannot be merged (reviews, checks or conflicts).',
    };
  }
  if (code === 'github_422') return { outcome: 'refused', message: 'GitHub rejected the request.' };
  if (code === 'github_403') {
    return { outcome: 'failed', message: 'The token is not allowed to do this.' };
  }
  if (code === 'github_404') {
    return {
      outcome: 'failed',
      message: 'GitHub says it was not found, or the token cannot see it.',
    };
  }
  return { outcome: 'failed', message: `GitHub could not do this right now (${code}).` };
}

type Scope = {
  db: ActionsOptions['db'];
  workspaceId: string;
  projectId: string;
  number: number;
  now: Date;
};

/** Brings the stored copy in step with what GitHub was just told, so the list is right before the next sync. */
async function applyLocally(
  options: ActionsOptions,
  projectId: string,
  action: GithubActionRequest,
  now: Date,
): Promise<void> {
  if (!('number' in action)) return;
  const scope: Scope = {
    db: options.db,
    workspaceId: options.workspaceId,
    projectId,
    number: action.number,
    now,
  };
  const pr = and(
    eq(pullRequests.workspaceId, scope.workspaceId),
    eq(pullRequests.projectId, scope.projectId),
    eq(pullRequests.number, scope.number),
  );
  const issue = and(
    eq(githubIssues.workspaceId, scope.workspaceId),
    eq(githubIssues.projectId, scope.projectId),
    eq(githubIssues.number, scope.number),
  );
  switch (action.action) {
    case 'merge':
      await scope.db
        .update(pullRequests)
        .set({ state: 'merged', mergedAt: now, closedAt: now })
        .where(and(pr, eq(pullRequests.state, 'open')));
      return;
    case 'close':
      await scope.db.update(githubIssues).set({ state: 'closed', closedAt: now }).where(issue);
      await scope.db
        .update(pullRequests)
        .set({ state: 'closed', closedAt: now })
        .where(and(pr, eq(pullRequests.state, 'open')));
      return;
    case 'reopen':
      await scope.db.update(githubIssues).set({ state: 'open', closedAt: null }).where(issue);
      await scope.db
        .update(pullRequests)
        .set({ state: 'open', closedAt: null })
        .where(and(pr, eq(pullRequests.state, 'closed')));
      return;
    case 'labels':
      await scope.db.update(githubIssues).set({ labels: action.labels }).where(issue);
      await scope.db.update(pullRequests).set({ labels: action.labels }).where(pr);
      return;
    case 'assign':
      await scope.db.update(githubIssues).set({ assignees: action.assignees }).where(issue);
      return;
    case 'requestReviewers': {
      const [row] = await scope.db
        .select({ requested: pullRequests.requestedReviewers })
        .from(pullRequests)
        .where(pr)
        .limit(1);
      if (row === undefined) return;
      const merged = [...new Set([...row.requested, ...action.reviewers])];
      await scope.db.update(pullRequests).set({ requestedReviewers: merged }).where(pr);
      return;
    }
    default:
      return;
  }
}

/** What the stored pull request says, so a merge of something finished is refused without a call. */
async function mergeBlocker(
  options: ActionsOptions,
  projectId: string,
  number: number,
): Promise<string | null> {
  const [row] = await options.db
    .select({ state: pullRequests.state, draft: pullRequests.draft })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.workspaceId, options.workspaceId),
        eq(pullRequests.projectId, projectId),
        eq(pullRequests.number, number),
      ),
    )
    .limit(1);
  if (row === undefined) return null;
  if (row.state !== 'open') return `This pull request is already ${row.state}.`;
  return row.draft ? 'This pull request is a draft. Mark it ready for review first.' : null;
}

/** Bounded facts for the audit row: counts and methods, never a body or a token. */
function detailOf(action: GithubActionRequest): Record<string, unknown> {
  switch (action.action) {
    case 'comment':
      return { length: action.body.length };
    case 'labels':
      return { labels: action.labels.length };
    case 'assign':
      return { assignees: action.assignees.length };
    case 'requestReviewers':
      return { reviewers: action.reviewers.length };
    case 'review':
      return { event: action.event, length: action.body?.length ?? 0 };
    case 'merge':
      return { method: action.method, sha: action.sha.slice(0, 12) };
    case 'createRelease':
      return { tag: action.tag, draft: action.draft, prerelease: action.prerelease };
    default:
      return {};
  }
}

type Found =
  | { ok: true; resolved: Resolved; branch: string; target: string }
  | { ok: false; target: string; message: string };

/**
 * The repository, default branch and token an action will use, or the reason it cannot run.
 * A project in another workspace is "no such project", exactly as a missing one is.
 */
async function resolveTarget(options: ActionsOptions, action: GithubActionRequest): Promise<Found> {
  let target = action.projectId;
  try {
    const project = await projectRow(options, action.projectId);
    const repository = githubRepository(project.repositoryUrl);
    if (repository === null) {
      return {
        ok: false,
        target: project.name,
        message: 'This project is not a GitHub repository.',
      };
    }
    const branch = project.defaultBranch ?? 'main';
    target = targetOf(repository, action, branch);
    const token = await options.tokenFor(options.workspaceId, project.id).catch(() => null);
    if (token === null) {
      return {
        ok: false,
        target,
        message: 'No GitHub token is stored for this project. Save one on the project to act.',
      };
    }
    return { ok: true, resolved: { ...repository, token }, branch, target };
  } catch {
    return { ok: false, target, message: 'No such project in this workspace.' };
  }
}
export async function runGithubActions(
  options: ActionsOptions,
  actor: string,
  body: GithubActionsBody,
): Promise<GithubActionsResponse> {
  const now = (options.now ?? (() => new Date()))();
  const results: GithubActionResult[] = [];
  let limitedUntil: string | null = null;

  const record = async (
    action: GithubActionRequest,
    target: string,
    outcome: GithubActionResult['outcome'],
    message: string,
    retryAt: string | null,
  ): Promise<void> => {
    results.push({ action: action.action, target, outcome, message, retryAt });
    await audit(options, {
      actor,
      action: `github.${action.action}`,
      resourceType: 'project',
      resourceId: action.projectId,
      details: {
        target,
        outcome,
        dryRun: body.dryRun,
        ...detailOf(action),
        ...(outcome === 'ok' || outcome === 'planned' ? {} : { reason: message }),
      },
    });
  };

  for (const action of body.actions) {
    const found = await resolveTarget(options, action);
    if (!found.ok) {
      await record(action, found.target, 'refused', found.message, null);
      continue;
    }
    const { resolved, branch, target } = found;
    if (limitedUntil !== null) {
      await record(
        action,
        target,
        'failed',
        'Skipped: GitHub’s rate limit was reached. Try again later.',
        limitedUntil,
      );
      continue;
    }
    if (action.action === 'merge') {
      const blocker = await mergeBlocker(options, action.projectId, action.number);
      if (blocker !== null) {
        await record(action, target, 'refused', blocker, null);
        continue;
      }
    }
    if (body.dryRun) {
      await record(action, target, 'planned', planOf(action, target), null);
      continue;
    }

    if (action.action === 'protectBranch') {
      const protectedResult = await protectBranch(options, resolved, branch, action);
      if (protectedResult.retryAt !== undefined) limitedUntil = protectedResult.retryAt;
      await record(
        action,
        target,
        protectedResult.outcome,
        protectedResult.message,
        protectedResult.retryAt ?? null,
      );
      continue;
    }
    const call = callOf(action);
    const request: ConnectorRequest = {
      operation: call.operation,
      input: { owner: resolved.owner, repo: resolved.repo, ...call.input },
    };
    const result = await options.adapter.execute(request, resolved.token);
    if (result.status === 'ok') {
      await applyLocally(options, action.projectId, action, now);
      await record(action, target, 'ok', 'Done.', null);
      continue;
    }
    if (result.error?.code === 'github_rate_limited') {
      limitedUntil = result.error.retryAt ?? new Date(now.getTime() + 60_000).toISOString();
      await record(
        action,
        target,
        'failed',
        'GitHub’s rate limit was reached. Try again later.',
        limitedUntil,
      );
      continue;
    }
    const refused = refusalOf(action, result);
    await record(action, target, refused.outcome, refused.message, null);
  }
  return { dryRun: body.dryRun, results };
}
