import { z } from 'zod/v4';

/**
 * A release sign-off (plan Wave 1 task 5): a person's ship or hold on one project's commit,
 * recorded against the readiness verdict the server computed at that moment.
 *
 * The verdict is never sent by the client. A ship against a no-go verdict is an override:
 * only an admin may record one, and every reader is told it is one.
 */
export const SignoffDecisionSchema = z.enum(['ship', 'hold']);
export type SignoffDecision = z.infer<typeof SignoffDecisionSchema>;

/** `POST /api/v1/projects/:id/signoffs` (operator; an override needs admin). */
export const SignoffBodySchema = z.object({
  commit: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{7,40}$/u, 'a commit is 7 to 40 hex characters'),
  decision: SignoffDecisionSchema,
  reason: z.string().trim().min(1).max(2_000),
});
export type SignoffBody = z.infer<typeof SignoffBodySchema>;

export const ReleaseSignoffSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  commit: z.string().min(1),
  decision: SignoffDecisionSchema,
  /** The readiness verdict the decision was made against. */
  verdict: z.enum(['go', 'caution', 'no-go']),
  /** A ship against a no-go verdict. */
  override: z.boolean(),
  reason: z.string().min(1),
  actor: z.string().min(1),
  createdAt: z.string().min(1),
});
export type ReleaseSignoff = z.infer<typeof ReleaseSignoffSchema>;

/** `GET /api/v1/projects/:id/signoffs`: newest first, at most 20. */
export const ReleaseSignoffListSchema = z.object({ signoffs: z.array(ReleaseSignoffSchema) });
export type ReleaseSignoffList = z.infer<typeof ReleaseSignoffListSchema>;
