import { z } from 'zod/v4';

/** `GET /api/v1/self-checks`: what the install noticed about itself (plan 1795712849115 task 16). */
export const SelfCheckItemSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['bad', 'caution']),
  title: z.string().min(1),
  detail: z.string(),
  /** The one fix: a place in the product. */
  fix: z.object({ label: z.string().min(1), to: z.string().startsWith('/') }),
  at: z.string(),
});
export type SelfCheckItemContract = z.infer<typeof SelfCheckItemSchema>;

export const SelfChecksSchema = z.object({
  evaluatedAt: z.string(),
  items: z.array(SelfCheckItemSchema),
});
export type SelfChecks = z.infer<typeof SelfChecksSchema>;
