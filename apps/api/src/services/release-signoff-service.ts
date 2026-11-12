import { and, desc, eq } from 'drizzle-orm';
import { releaseSignoffs, type ReleaseSignoffRow } from '@lupin/db';
import type { ReleaseSignoff, SignoffBody } from '@lupin/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;
type Verdict = ReleaseSignoff['verdict'];

function view(row: ReleaseSignoffRow): ReleaseSignoff {
  return {
    id: row.id,
    projectId: row.projectId,
    commit: row.commitSha,
    decision: row.decision as ReleaseSignoff['decision'],
    verdict: row.verdict as Verdict,
    override: row.override,
    reason: row.reason,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Records a ship or hold against the verdict the server computed (plan Wave 1 task 5). A ship
 * against no-go is an override and needs an admin; the database refuses a row that disagrees.
 */
export async function recordSignoff(
  options: Options,
  input: {
    projectId: string;
    body: SignoffBody;
    verdict: Verdict;
    actor: string;
    isAdmin: boolean;
  },
): Promise<ReleaseSignoff> {
  const override = input.body.decision === 'ship' && input.verdict === 'no-go';
  if (override && !input.isAdmin) {
    throw new DomainError(ErrorCode.FORBIDDEN, 'Only an admin can ship against a no-go verdict', {
      details: { fix: 'Ask an admin to record the override, or hold the release.' },
    });
  }
  const [row] = await options.db
    .insert(releaseSignoffs)
    .values({
      workspaceId: options.workspaceId,
      projectId: input.projectId,
      commitSha: input.body.commit,
      decision: input.body.decision,
      verdict: input.verdict,
      override,
      reason: input.body.reason,
      actor: input.actor,
    })
    .returning();
  return view(row as ReleaseSignoffRow);
}

/** This workspace's sign-offs for one project, newest first. */
export async function listSignoffs(options: Options, projectId: string): Promise<ReleaseSignoff[]> {
  const rows = await options.db
    .select()
    .from(releaseSignoffs)
    .where(
      and(
        eq(releaseSignoffs.workspaceId, options.workspaceId),
        eq(releaseSignoffs.projectId, projectId),
      ),
    )
    .orderBy(desc(releaseSignoffs.createdAt))
    .limit(20);
  return rows.map(view);
}
