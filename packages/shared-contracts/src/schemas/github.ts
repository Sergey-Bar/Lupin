import { z } from 'zod/v4';
import { ChangeRiskLevelSchema } from './change-risk.js';

/**
 * The GitHub command center's contracts: what the inbox returns and what an action asks for.
 *
 * Reads come from the database the delivery sync fills, never from GitHub per request, so every
 * list is bounded and keyset-paged: `cursor` is opaque, and a page is `limit` items at most.
 */

const Instant = z.string();
const Uuid = z.string().uuid();

export const GithubReviewDecisionSchema = z.enum([
  'approved',
  'changes_requested',
  'review_required',
]);
export const GithubChecksStateSchema = z.enum(['success', 'failure', 'pending']);

/** Query-string numbers arrive as strings. */
const IntFromQuery = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const GithubInboxQuerySchema = z.object({
  projectId: Uuid.optional(),
  state: z.enum(['open', 'closed', 'merged', 'all']).default('open'),
  author: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(100).optional(),
  review: GithubReviewDecisionSchema.optional(),
  checks: GithubChecksStateSchema.optional(),
  draft: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  /** Only items with no activity for this many days. */
  staleDays: IntFromQuery(1, 3650).optional(),
  limit: IntFromQuery(1, 100).default(50),
  cursor: z.string().max(300).optional(),
});
export type GithubInboxQuery = z.infer<typeof GithubInboxQuerySchema>;

export const GithubPullItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  /** `owner/repo`. */
  repository: z.string(),
  number: z.number().int(),
  title: z.string(),
  author: z.string().nullable(),
  state: z.enum(['open', 'closed', 'merged']),
  draft: z.boolean(),
  htmlUrl: z.string().nullable(),
  headBranch: z.string().nullable(),
  baseBranch: z.string().nullable(),
  labels: z.array(z.string()),
  reviewDecision: GithubReviewDecisionSchema.nullable(),
  checksState: GithubChecksStateSchema.nullable(),
  mergeableState: z.string().nullable(),
  requestedReviewers: z.array(z.string()),
  openedAt: Instant,
  lastActivityAt: Instant,
  additions: z.number().int(),
  deletions: z.number().int(),
  /** The head commit a merge must name, so a stale view cannot merge newer commits. */
  headSha: z.string().nullable(),
  /**
   * The latest change-risk assessment, `null` when the gate never assessed this pull request.
   * `current` is false when it was assessed at another head: the risk of commits since is not
   * known. Absent from an install that predates change risk.
   */
  risk: z
    .object({
      level: ChangeRiskLevelSchema,
      score: z.number().int().min(0),
      headSha: z.string(),
      assessedAt: Instant,
      current: z.boolean(),
    })
    .nullable()
    .optional(),
});
export type GithubPullItem = z.infer<typeof GithubPullItemSchema>;

export const GithubIssueItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  repository: z.string(),
  number: z.number().int(),
  title: z.string(),
  author: z.string().nullable(),
  state: z.enum(['open', 'closed']),
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  commentCount: z.number().int(),
  htmlUrl: z.string().nullable(),
  openedAt: Instant,
  lastActivityAt: Instant,
});
export type GithubIssueItem = z.infer<typeof GithubIssueItemSchema>;

export const GithubPullPageSchema = z.object({
  items: z.array(GithubPullItemSchema),
  nextCursor: z.string().nullable(),
});
export const GithubIssuePageSchema = z.object({
  items: z.array(GithubIssueItemSchema),
  nextCursor: z.string().nullable(),
});

const SeverityCountsSchema = z.object({
  critical: z.number().int(),
  high: z.number().int(),
  medium: z.number().int(),
  low: z.number().int(),
  truncated: z.boolean(),
});
/** A feed reads as counts, or as "the token cannot see it", never as zero. */
const AlertSummarySchema = z.union([
  SeverityCountsSchema,
  z.object({ unavailable: z.enum(['forbidden', 'not_found']) }),
]);

export const GithubRepoStateSchema = z.object({
  community: z
    .object({
      healthPercentage: z.number().nullable(),
      license: z.boolean(),
      codeOfConduct: z.boolean(),
      contributing: z.boolean(),
      issueTemplate: z.boolean(),
      pullRequestTemplate: z.boolean(),
      readme: z.boolean(),
    })
    .nullable(),
  protection: z.discriminatedUnion('state', [
    z.object({
      state: z.literal('protected'),
      requiresReview: z.boolean(),
      requiresChecks: z.boolean(),
    }),
    z.object({ state: z.literal('unprotected') }),
    z.object({ state: z.literal('unavailable') }),
  ]),
  alerts: z.object({
    dependabot: AlertSummarySchema,
    codeScanning: AlertSummarySchema,
    secretScanning: AlertSummarySchema,
  }),
  rateLimit: z.object({ limit: z.number(), remaining: z.number(), resetAt: z.string() }).nullable(),
  syncedAt: Instant,
});
export type GithubRepoState = z.infer<typeof GithubRepoStateSchema>;

export const GithubFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string(),
  /** What was counted or found, so it can be checked against GitHub in one click. */
  evidence: z.string(),
  /** A fix Lupin can apply itself, when there is one. */
  fix: z.enum(['protect-branch']).nullable(),
  /**
   * The numbers and names the sentence was made from, so a client in another language can write
   * its own: count, days, the severities, missing and feeds as keys. title and
   * evidence stay as the English fallback.
   */
  params: z.record(z.string(), z.union([z.number(), z.boolean(), z.array(z.string())])),
});
export type GithubFinding = z.infer<typeof GithubFindingSchema>;

export const GithubHealthSchema = z.object({
  /** `null` for a repository that has not been read yet: not graded, not 100. */
  score: z.number().int().nullable(),
  grade: z.string().nullable(),
  findings: z.array(GithubFindingSchema),
});
export type GithubHealth = z.infer<typeof GithubHealthSchema>;

export const GithubRepoItemSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  repository: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  /** Whether the delivery sync reads this repository. Off, nothing below is filled in. */
  syncEnabled: z.boolean(),
  lastSyncedAt: Instant.nullable(),
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  openPullRequests: z.number().int(),
  openIssues: z.number().int(),
  /** Open pull requests with nothing happening for 14 days. */
  stalePullRequests: z.number().int(),
  state: GithubRepoStateSchema.nullable(),
  health: GithubHealthSchema,
});
export type GithubRepoItem = z.infer<typeof GithubRepoItemSchema>;

export const GithubRepoListSchema = z.object({ items: z.array(GithubRepoItemSchema) });

// ─── Actions ────────────────────────────────────────────────────────────────

const Target = { projectId: Uuid, number: z.number().int().min(1) };
const Logins = z.array(z.string().min(1).max(100)).min(1).max(20);

/**
 * One write to GitHub. A closed set: the action service refuses anything else, and each member
 * names exactly the fields it needs, so no free-form request reaches GitHub through here.
 */
export const GithubActionRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('comment'), ...Target, body: z.string().min(1).max(65_536) }),
  z.object({
    action: z.literal('labels'),
    ...Target,
    labels: z.array(z.string().min(1).max(100)).max(50),
  }),
  z.object({
    action: z.literal('assign'),
    ...Target,
    assignees: z.array(z.string().min(1).max(100)).max(10),
  }),
  z.object({ action: z.literal('close'), ...Target }),
  z.object({ action: z.literal('reopen'), ...Target }),
  z.object({ action: z.literal('requestReviewers'), ...Target, reviewers: Logins }),
  z.object({
    action: z.literal('review'),
    ...Target,
    event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
    body: z.string().max(65_536).optional(),
  }),
  z.object({
    action: z.literal('merge'),
    ...Target,
    /** The head commit the person looked at. GitHub refuses the merge if the branch moved. */
    sha: z.string().min(7).max(64),
    method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
  }),
  z.object({
    action: z.literal('updateBranch'),
    ...Target,
    sha: z.string().min(7).max(64).optional(),
  }),
  z.object({
    action: z.literal('rerunWorkflow'),
    projectId: Uuid,
    runId: z.string().regex(/^\d+$/u),
  }),
  /**
   * Requires one approving review on the project's default branch. The branch is the server's
   * to know. It refuses to replace protection that already exists: this only fills a gap.
   */
  z.object({ action: z.literal('protectBranch'), projectId: Uuid }),
  z.object({
    action: z.literal('createRelease'),
    projectId: Uuid,
    /** A git ref name: no spaces, no `..`, no leading dash. */
    tag: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u)
      .refine((tag) => !tag.includes('..'), 'a tag cannot contain ".."'),
    name: z.string().max(200).optional(),
    notes: z.string().max(125_000).optional(),
    draft: z.boolean().default(false),
    prerelease: z.boolean().default(false),
  }),
]);
export type GithubActionRequest = z.infer<typeof GithubActionRequestSchema>;

/** One or many actions, in one request. `dryRun` returns the plan and writes nothing. */
export const GithubActionsBodySchema = z.object({
  dryRun: z.boolean().default(false),
  actions: z.array(GithubActionRequestSchema).min(1).max(50),
});
export type GithubActionsBody = z.infer<typeof GithubActionsBodySchema>;

export const GithubActionResultSchema = z.object({
  action: z.string(),
  target: z.string(),
  outcome: z.enum(['planned', 'ok', 'refused', 'failed']),
  /** Why it was refused or failed, or what a dry run would do. Never a token or a request body. */
  message: z.string(),
  /** `github_rate_limited` carries when to try again. */
  retryAt: z.string().nullable(),
});
export type GithubActionResult = z.infer<typeof GithubActionResultSchema>;

export const GithubActionsResponseSchema = z.object({
  dryRun: z.boolean(),
  results: z.array(GithubActionResultSchema),
});
export type GithubActionsResponse = z.infer<typeof GithubActionsResponseSchema>;
