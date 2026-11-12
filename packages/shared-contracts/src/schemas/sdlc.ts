import { z } from 'zod/v4';

/**
 * The five phases a change moves through — plan, code, test, review, release — read per pull
 * request from what was recorded, and rolled up per repository and across the portfolio.
 *
 * A phase with no evidence is `not_measured`, never `done` (PHASE-1). A phase a change went past
 * — a later phase done while this one was not — is `skipped` (PHASE-2), which is the thing a QA
 * lead wants to see: an AI-written change merged with no human review, a change merged with no
 * tests on its head.
 */

export const SDLC_PHASES = ['plan', 'code', 'test', 'review', 'release'] as const;
export const SdlcPhaseSchema = z.enum(SDLC_PHASES);
export type SdlcPhase = z.infer<typeof SdlcPhaseSchema>;

export const PHASE_STATES = ['done', 'in_progress', 'pending', 'skipped', 'not_measured'] as const;
export const PhaseStateSchema = z.enum(PHASE_STATES);
export type PhaseState = z.infer<typeof PhaseStateSchema>;

export const SHAPES = ['good', 'caution', 'bad', 'unknown'] as const;
export const ShapeSchema = z.enum(SHAPES);
export type Shape = z.infer<typeof ShapeSchema>;

export const PhaseStepSchema = z.object({
  phase: SdlcPhaseSchema,
  state: PhaseStateSchema,
  /** Time spent in the phase, in hours; `null` when either end is unknown. */
  hours: z.number().min(0).nullable(),
  shape: ShapeSchema,
  /** One sentence a reader can check. */
  reason: z.string().min(1).max(300),
});
export type PhaseStep = z.infer<typeof PhaseStepSchema>;

/** One pull request's strip: every phase in order, and the worst shape among them. */
export const PhaseStripSchema = z.object({
  version: z.string().min(1),
  pullRequest: z.number().int().min(1),
  phases: z.array(PhaseStepSchema).length(SDLC_PHASES.length),
  shape: ShapeSchema,
  skipped: z.array(SdlcPhaseSchema),
});
export type PhaseStrip = z.infer<typeof PhaseStripSchema>;

/** One phase across a repository's changes in a window. */
export const PhaseBandEntrySchema = z.object({
  phase: SdlcPhaseSchema,
  shape: ShapeSchema,
  /** Changes whose phase was measured at all. */
  measured: z.number().int().min(0),
  done: z.number().int().min(0),
  skipped: z.number().int().min(0),
  /** In progress for longer than the phase's threshold. */
  stuck: z.number().int().min(0),
  /** Median hours over the changes that finished the phase; `null` with none. */
  medianHours: z.number().min(0).nullable(),
  reason: z.string().min(1).max(300),
});
export type PhaseBandEntry = z.infer<typeof PhaseBandEntrySchema>;

export const STUCK_LIST_LIMIT = 10;

/** `GET /api/v1/projects/:id/phases` */
export const RepositoryPhasesSchema = z.object({
  projectId: z.string().min(1),
  version: z.string().min(1),
  evaluatedAt: z.iso.datetime({ offset: true }),
  windowDays: z.number().int().min(1).max(366),
  /** The changes read: open now, or merged or closed in the window. */
  changes: z.number().int().min(0),
  phases: z.array(PhaseBandEntrySchema).length(SDLC_PHASES.length),
  /** The phase most behind, when one is: "Review is the bottleneck: 11 waiting over 2 days". */
  bottleneck: z.object({ phase: SdlcPhaseSchema, sentence: z.string().min(1) }).nullable(),
  /** Open changes stuck in a phase, longest first, at most {@link STUCK_LIST_LIMIT}. */
  stuck: z.array(
    z.object({
      pullRequest: z.number().int().min(1),
      title: z.string(),
      phase: SdlcPhaseSchema,
      hours: z.number().min(0),
    }),
  ),
  /** More changes were in the window than were read; every count is a lower bound. */
  truncated: z.boolean(),
  /** `false` when the delivery sync has read no pull request: nothing here is measured. */
  configured: z.boolean(),
});
export type RepositoryPhases = z.infer<typeof RepositoryPhasesSchema>;

/** `GET /api/v1/portfolio/phases`: one row per repository, one shape per phase. */
export const PortfolioPhasesSchema = z.object({
  evaluatedAt: z.iso.datetime({ offset: true }),
  windowDays: z.number().int().min(1).max(366),
  projects: z.array(
    z.object({
      projectId: z.string().min(1),
      name: z.string().min(1),
      changes: z.number().int().min(0),
      configured: z.boolean(),
      phases: z.array(z.object({ phase: SdlcPhaseSchema, shape: ShapeSchema })).length(5),
    }),
  ),
  total: z.number().int().min(0),
  truncated: z.boolean(),
});
export type PortfolioPhases = z.infer<typeof PortfolioPhasesSchema>;
