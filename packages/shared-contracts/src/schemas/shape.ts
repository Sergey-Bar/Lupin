import { z } from 'zod/v4';
import { ShapeSchema } from './sdlc.js';

/**
 * Are we in good shape or bad shape: one verdict per level (a pull request, a repository, the
 * portfolio), with how fresh the evidence behind it is.
 *
 * A verdict is read from signals, each a shape and the time it was measured. Two rules hold at
 * every level (SHAPE-1, SHAPE-2 in `docs/quality/property-invariants.json`): a signal that was
 * not measured keeps the verdict from being good, and so does evidence older than the stale
 * window. Good means measured, recent and fine; anything less says which.
 */

export const FRESHNESS = ['fresh', 'stale', 'never'] as const;
export const FreshnessSchema = z.enum(FRESHNESS);
export type Freshness = z.infer<typeof FreshnessSchema>;

export const SHAPE_SIGNALS = ['grade', 'tests', 'phases', 'risk'] as const;
export const ShapeSignalIdSchema = z.enum(SHAPE_SIGNALS);
export type ShapeSignalId = z.infer<typeof ShapeSignalIdSchema>;

export const ShapeSignalSchema = z.object({
  id: ShapeSignalIdSchema,
  shape: ShapeSchema,
  /** When it was measured; `null` when it never was. */
  at: z.iso.datetime({ offset: true }).nullable(),
  /** One sentence a reader can check. */
  reason: z.string().min(1).max(300),
});
export type ShapeSignal = z.infer<typeof ShapeSignalSchema>;

export const ShapeReadingSchema = z.object({
  version: z.string().min(1),
  shape: ShapeSchema,
  freshness: FreshnessSchema,
  /** The newest measured signal's time; `null` when nothing was measured. */
  measuredAt: z.iso.datetime({ offset: true }).nullable(),
  /** Why the verdict is what it is, in one sentence. */
  reason: z.string().min(1).max(400),
  signals: z.array(ShapeSignalSchema).max(10),
});
export type ShapeReading = z.infer<typeof ShapeReadingSchema>;

/** `GET /api/v1/projects/:id/shape`, and one pull request's at `…/pull-requests/:number/shape`. */
export const ScopedShapeSchema = ShapeReadingSchema.extend({
  projectId: z.string().min(1),
  name: z.string().min(1),
  /** Set for a pull request's shape. */
  pullRequest: z.number().int().min(1).nullable(),
});
export type ScopedShape = z.infer<typeof ScopedShapeSchema>;

/** `GET /api/v1/portfolio/shape`: the workspace's verdict, and every repository's, worst first. */
export const PortfolioShapeSchema = z.object({
  evaluatedAt: z.iso.datetime({ offset: true }),
  overall: ShapeReadingSchema,
  projects: z.array(ScopedShapeSchema),
  total: z.number().int().min(0),
  truncated: z.boolean(),
});
export type PortfolioShape = z.infer<typeof PortfolioShapeSchema>;
