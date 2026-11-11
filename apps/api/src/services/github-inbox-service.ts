import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  deliverySources,
  githubIssues,
  projects,
  pullRequestRiskAssessments,
  pullRequests,
  repoGithubState,
} from '@lupin/db';
import {
  ChangeRiskLevelSchema,
  GithubRepoStateSchema,
  type GithubInboxQuery,
  type GithubIssueItem,
  type GithubPullItem,
  type GithubRepoItem,
} from '@lupin/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { HealthStoreOptions } from './health-findings.js';
import { projectRow } from './health-findings.js';
import { STALE_DAYS, UNREVIEWED_DAYS, analyzeRepository } from './github-health.js';
import { githubRepository } from './health-integrations.js';

/**
 * What the command center shows: pull requests, issues and repositories across every project in
 * the workspace, read from the tables the delivery sync fills.
 *
 * Every query starts from `workspace_id`, and a project id from the request is only ever an
 * additional filter, so a foreign project's id returns nothing rather than a foreign row.
 * Lists are keyset-paged on `(last_activity_at, id)`: a page boundary that falls between rows
 * sharing a timestamp neither skips nor repeats one.
 */
export type InboxOptions = HealthStoreOptions & { now?: () => Date };

const DAY_MS = 86_400_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

/** `null` for anything that is not a cursor this service wrote. Never an error. */
export function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [iso, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (iso === undefined || id === undefined || rest.length > 0 || !UUID.test(id)) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) || at.toISOString() !== iso ? null : { at, id };
}

/** `owner/repo` for a project, or its name when the URL is not on the configured host. */
function repositoryName(url: string | null, fallback: string): string {
  const parsed = githubRepository(url);
  return parsed === null ? fallback : `${parsed.owner}/${parsed.repo}`;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

function labelFilter(column: unknown, label: string): SQL {
  return sql`${column} @> ${JSON.stringify([label])}::jsonb`;
}

type PullRisk = NonNullable<GithubPullItem['risk']>;

/**
 * Each listed pull request's latest change-risk assessment, keyed `projectId:number`. One read
 * for the page, bounded by the page's projects and numbers, newest first, so the first row seen
 * for a pull request is its latest. `current` says whether it was assessed at today's head.
 */
async function latestRisks(
  options: InboxOptions,
  pulls: ReadonlyArray<{ projectId: string; number: number; headSha: string | null }>,
): Promise<Map<string, PullRisk>> {
  const risks = new Map<string, PullRisk>();
  if (pulls.length === 0) return risks;
  const heads = new Map(
    pulls.map((pull) => [`${pull.projectId}:${String(pull.number)}`, pull.headSha]),
  );
  const rows = await options.db
    .select({
      projectId: pullRequestRiskAssessments.projectId,
      prNumber: pullRequestRiskAssessments.prNumber,
      headSha: pullRequestRiskAssessments.headSha,
      level: pullRequestRiskAssessments.level,
      score: pullRequestRiskAssessments.score,
      assessedAt: pullRequestRiskAssessments.assessedAt,
    })
    .from(pullRequestRiskAssessments)
    .where(
      and(
        eq(pullRequestRiskAssessments.workspaceId, options.workspaceId),
        inArray(pullRequestRiskAssessments.projectId, [
          ...new Set(pulls.map((pull) => pull.projectId)),
        ]),
        inArray(pullRequestRiskAssessments.prNumber, [
          ...new Set(pulls.map((pull) => pull.number)),
        ]),
      ),
    )
    .orderBy(desc(pullRequestRiskAssessments.assessedAt), desc(pullRequestRiskAssessments.id));
  for (const row of rows) {
    const key = `${row.projectId}:${String(row.prNumber)}`;
    const level = ChangeRiskLevelSchema.safeParse(row.level);
    if (!heads.has(key) || risks.has(key) || !level.success) continue;
    const head = heads.get(key) ?? null;
    risks.set(key, {
      level: level.data,
      score: row.score,
      headSha: row.headSha,
      assessedAt: row.assessedAt.toISOString(),
      current: head !== null && head.toLowerCase() === row.headSha,
    });
  }
  return risks;
}

export async function listPullRequests(
  options: InboxOptions,
  query: GithubInboxQuery,
): Promise<Page<GithubPullItem>> {
  const now = (options.now ?? (() => new Date()))();
  const conditions: SQL[] = [eq(pullRequests.workspaceId, options.workspaceId)];
  if (query.projectId !== undefined) conditions.push(eq(pullRequests.projectId, query.projectId));
  if (query.state !== 'all') conditions.push(eq(pullRequests.state, query.state));
  if (query.author !== undefined) conditions.push(eq(pullRequests.authorLogin, query.author));
  if (query.label !== undefined) conditions.push(labelFilter(pullRequests.labels, query.label));
  if (query.review !== undefined) conditions.push(eq(pullRequests.reviewDecision, query.review));
  if (query.checks !== undefined) conditions.push(eq(pullRequests.checksState, query.checks));
  if (query.draft !== undefined) conditions.push(eq(pullRequests.draft, query.draft));
  if (query.staleDays !== undefined) {
    conditions.push(
      lt(pullRequests.lastActivityAt, new Date(now.getTime() - query.staleDays * DAY_MS)),
    );
  }
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  if (after !== null) {
    conditions.push(
      or(
        lt(pullRequests.lastActivityAt, after.at),
        and(eq(pullRequests.lastActivityAt, after.at), lt(pullRequests.id, after.id)),
      ) as SQL,
    );
  }
  // One extra row says whether another page exists without a second count query.
  const rows = await options.db
    .select({ pr: pullRequests, projectName: projects.name, repositoryUrl: projects.repositoryUrl })
    .from(pullRequests)
    .innerJoin(projects, eq(projects.id, pullRequests.projectId))
    .where(and(...conditions))
    .orderBy(desc(pullRequests.lastActivityAt), desc(pullRequests.id))
    .limit(query.limit + 1);
  const shown = rows.slice(0, query.limit);
  const last = shown.at(-1);
  const risks = await latestRisks(
    options,
    shown.map(({ pr }) => pr),
  );
  return {
    items: shown.map(({ pr, projectName, repositoryUrl }) => ({
      id: pr.id,
      projectId: pr.projectId,
      projectName,
      repository: repositoryName(repositoryUrl, projectName),
      number: pr.number,
      title: pr.title,
      author: pr.authorLogin,
      state: pr.state as GithubPullItem['state'],
      draft: pr.draft,
      htmlUrl: pr.htmlUrl,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      labels: pr.labels,
      reviewDecision: pr.reviewDecision as GithubPullItem['reviewDecision'],
      checksState: pr.checksState as GithubPullItem['checksState'],
      mergeableState: pr.mergeableState,
      requestedReviewers: pr.requestedReviewers,
      openedAt: pr.openedAt.toISOString(),
      lastActivityAt: pr.lastActivityAt.toISOString(),
      additions: pr.additions,
      deletions: pr.deletions,
      headSha: pr.headSha,
      risk: risks.get(`${pr.projectId}:${String(pr.number)}`) ?? null,
    })),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor(last.pr.lastActivityAt, last.pr.id)
        : null,
  };
}

export async function listIssues(
  options: InboxOptions,
  query: GithubInboxQuery,
): Promise<Page<GithubIssueItem>> {
  const now = (options.now ?? (() => new Date()))();
  const conditions: SQL[] = [eq(githubIssues.workspaceId, options.workspaceId)];
  if (query.projectId !== undefined) conditions.push(eq(githubIssues.projectId, query.projectId));
  // 'merged' is a pull request state; no issue is ever in it.
  if (query.state === 'merged') return { items: [], nextCursor: null };
  if (query.state !== 'all') conditions.push(eq(githubIssues.state, query.state));
  if (query.author !== undefined) conditions.push(eq(githubIssues.authorLogin, query.author));
  if (query.label !== undefined) conditions.push(labelFilter(githubIssues.labels, query.label));
  if (query.staleDays !== undefined) {
    conditions.push(
      lt(githubIssues.lastActivityAt, new Date(now.getTime() - query.staleDays * DAY_MS)),
    );
  }
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  if (after !== null) {
    conditions.push(
      or(
        lt(githubIssues.lastActivityAt, after.at),
        and(eq(githubIssues.lastActivityAt, after.at), lt(githubIssues.id, after.id)),
      ) as SQL,
    );
  }
  const rows = await options.db
    .select({
      issue: githubIssues,
      projectName: projects.name,
      repositoryUrl: projects.repositoryUrl,
    })
    .from(githubIssues)
    .innerJoin(projects, eq(projects.id, githubIssues.projectId))
    .where(and(...conditions))
    .orderBy(desc(githubIssues.lastActivityAt), desc(githubIssues.id))
    .limit(query.limit + 1);
  const shown = rows.slice(0, query.limit);
  const last = shown.at(-1);
  return {
    items: shown.map(({ issue, projectName, repositoryUrl }) => ({
      id: issue.id,
      projectId: issue.projectId,
      projectName,
      repository: repositoryName(repositoryUrl, projectName),
      number: issue.number,
      title: issue.title,
      author: issue.authorLogin,
      state: issue.state as GithubIssueItem['state'],
      labels: issue.labels,
      assignees: issue.assignees,
      commentCount: issue.commentCount,
      htmlUrl: issue.htmlUrl,
      openedAt: issue.openedAt.toISOString(),
      lastActivityAt: issue.lastActivityAt.toISOString(),
    })),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor(last.issue.lastActivityAt, last.issue.id)
        : null,
  };
}

interface PullCounts {
  open: number;
  stale: number;
  failing: number;
  conflicted: number;
  unreviewed: number;
}

/** Open pull requests per project, with the counts the health analysis grades. One query. */
async function pullCounts(options: InboxOptions, now: Date): Promise<Map<string, PullCounts>> {
  const staleBefore = new Date(now.getTime() - STALE_DAYS * DAY_MS);
  const unreviewedBefore = new Date(now.getTime() - UNREVIEWED_DAYS * DAY_MS);
  const rows = await options.db
    .select({
      projectId: pullRequests.projectId,
      open: sql<number>`count(*)::int`,
      stale: sql<number>`(count(*) filter (where ${pullRequests.lastActivityAt} < ${staleBefore}))::int`,
      failing: sql<number>`(count(*) filter (where ${pullRequests.checksState} = 'failure'))::int`,
      conflicted: sql<number>`(count(*) filter (where ${pullRequests.mergeableState} = 'dirty'))::int`,
      unreviewed: sql<number>`(count(*) filter (where ${pullRequests.reviewCount} = 0 and not ${pullRequests.draft} and ${pullRequests.openedAt} < ${unreviewedBefore}))::int`,
    })
    .from(pullRequests)
    .where(and(eq(pullRequests.workspaceId, options.workspaceId), eq(pullRequests.state, 'open')))
    .groupBy(pullRequests.projectId);
  return new Map(rows.map((row) => [row.projectId, row]));
}

/** Open issues per project, and how many have neither a label nor an assignee. */
async function issueCounts(
  options: InboxOptions,
): Promise<Map<string, { open: number; untriaged: number }>> {
  const rows = await options.db
    .select({
      projectId: githubIssues.projectId,
      open: sql<number>`count(*)::int`,
      untriaged: sql<number>`(count(*) filter (where ${githubIssues.labels} = '[]'::jsonb and ${githubIssues.assignees} = '[]'::jsonb))::int`,
    })
    .from(githubIssues)
    .where(and(eq(githubIssues.workspaceId, options.workspaceId), eq(githubIssues.state, 'open')))
    .groupBy(githubIssues.projectId);
  return new Map(rows.map((row) => [row.projectId, row]));
}
/** Every project that is a repository on the configured host, with its open work and sync state. */
export async function listRepos(options: InboxOptions): Promise<{ items: GithubRepoItem[] }> {
  const now = (options.now ?? (() => new Date()))();
  const all = await options.db
    .select({
      id: projects.id,
      name: projects.name,
      repositoryUrl: projects.repositoryUrl,
      defaultBranch: projects.defaultBranch,
    })
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId))
    .orderBy(projects.name);
  const repos = all.filter((project) => githubRepository(project.repositoryUrl) !== null);
  if (repos.length === 0) return { items: [] };
  const [sources, states, pulls, issues] = await Promise.all([
    options.db
      .select()
      .from(deliverySources)
      .where(eq(deliverySources.workspaceId, options.workspaceId)),
    options.db
      .select()
      .from(repoGithubState)
      .where(eq(repoGithubState.workspaceId, options.workspaceId)),
    pullCounts(options, now),
    issueCounts(options),
  ]);
  const sourceOf = new Map(sources.map((row) => [row.projectId, row]));
  const stateOf = new Map(states.map((row) => [row.projectId, row]));
  return {
    items: repos.map((project) => {
      const source = sourceOf.get(project.id);
      const stored = stateOf.get(project.id);
      const parsed =
        stored === undefined
          ? null
          : GithubRepoStateSchema.safeParse({
              community: stored.community,
              protection: stored.protection,
              alerts: stored.alerts,
              rateLimit: stored.rateLimit,
              syncedAt: stored.syncedAt.toISOString(),
            });
      const pr = pulls.get(project.id);
      const issue = issues.get(project.id);
      const state = parsed?.success === true ? parsed.data : null;
      const syncEnabled = source?.enabled ?? false;
      return {
        projectId: project.id,
        name: project.name,
        repository: repositoryName(project.repositoryUrl, project.name),
        defaultBranch: project.defaultBranch,
        syncEnabled,
        lastSyncedAt: source?.lastSyncedAt?.toISOString() ?? null,
        lastStatus: source?.lastStatus ?? null,
        lastError: source?.lastError ?? null,
        openPullRequests: pr?.open ?? 0,
        openIssues: issue?.open ?? 0,
        stalePullRequests: pr?.stale ?? 0,
        state,
        health: analyzeRepository({
          synced: syncEnabled && source?.lastSyncedAt != null,
          openPullRequests: pr?.open ?? 0,
          stalePullRequests: pr?.stale ?? 0,
          failingPullRequests: pr?.failing ?? 0,
          conflictedPullRequests: pr?.conflicted ?? 0,
          unreviewedPullRequests: pr?.unreviewed ?? 0,
          openIssues: issue?.open ?? 0,
          untriagedIssues: issue?.untriaged ?? 0,
          state:
            state === null
              ? null
              : { community: state.community, protection: state.protection, alerts: state.alerts },
        }),
      };
    }),
  };
}

/** One repository's overview. Another workspace's project, or a non-repository, is not found. */
export async function getRepoOverview(
  options: InboxOptions,
  projectId: string,
): Promise<GithubRepoItem> {
  await projectRow(options, projectId);
  const found = (await listRepos(options)).items.find((item) => item.projectId === projectId);
  if (found === undefined) {
    throw new DomainError(ErrorCode.NOT_FOUND, `No GitHub repository for project ${projectId}`);
  }
  return found;
}
