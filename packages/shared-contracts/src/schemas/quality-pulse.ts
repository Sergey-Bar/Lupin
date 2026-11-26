import { z } from 'zod/v4';

/**
 * `GET /api/v1/projects/:id/pulse`: whether a project's quality got better or worse, and why
 * (plan 1795712849115 task 14).
 *
 * One direction for the project, read from its vital signs, each compared with the window
 * before. Missing evidence is `unknown`, never `steady` and never `better`.
 */
export const PULSE_DIRECTIONS = ['better', 'worse', 'steady', 'unknown'] as const;
export const PulseDirectionSchema = z.enum(PULSE_DIRECTIONS);
export type PulseDirection = z.infer<typeof PulseDirectionSchema>;

export const PULSE_VITALS = [
  'gate',
  'pass-rate',
  'failing-tests',
  'flaky-rate',
  'coverage',
  'ai-change-failure-rate',
  'ai-revert-rate',
  'ai-diff-coverage',
] as const;
export const PulseVitalIdSchema = z.enum(PULSE_VITALS);
export type PulseVitalId = z.infer<typeof PulseVitalIdSchema>;

export const PulseVitalSchema = z.object({
  id: PulseVitalIdSchema,
  label: z.string(),
  unit: z.enum(['percent', 'count', 'status']),
  /** For `status` (the gate): 1 passed, 0 failed. */
  current: z.number().nullable(),
  previous: z.number().nullable(),
  delta: z.number().nullable(),
  direction: PulseDirectionSchema,
  /** Whether this sign is about AI-written change. */
  ai: z.boolean(),
});
export type PulseVital = z.infer<typeof PulseVitalSchema>;

export const QualityPulseSchema = z.object({
  projectId: z.string(),
  evaluatedAt: z.string(),
  windowDays: z.number().int().min(1),
  direction: PulseDirectionSchema,
  confidence: z.enum(['low', 'medium', 'high']),
  /** The one sign that decided the direction, or `null` when nothing moved or nothing is known. */
  cause: z.object({ vital: PulseVitalIdSchema, text: z.string() }).nullable(),
  /** One sentence for the Home band: the word, then the reason. */
  sentence: z.string(),
  vitals: z.array(PulseVitalSchema),
  /** Signs that moved the other way, so a "worse" never hides that something also improved. */
  alsoMoved: z.array(z.object({ vital: PulseVitalIdSchema, text: z.string() })),
});
export type QualityPulse = z.infer<typeof QualityPulseSchema>;
