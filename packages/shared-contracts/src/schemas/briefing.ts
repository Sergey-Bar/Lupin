import { z } from 'zod/v4';
import { ShapeSchema } from './sdlc.js';

/**
 * The briefing: what happened while nobody was looking, for one repository or the portfolio.
 *
 * Deterministic and cited. Every item is a sentence built from a count this install holds, and
 * names the evidence it was read from — a pull request, a report, a window — so a reader can
 * check any line. A window where nothing happened says so in one item and invents nothing
 * (BRIEF-1, BRIEF-2). An optional narration rewords these items and is held to them: it may
 * cite only these ids and use only these numbers.
 */

export const BRIEFING_SECTIONS = ['shape', 'shipped', 'riskier', 'quality', 'decide'] as const;
export const BriefingSectionIdSchema = z.enum(BRIEFING_SECTIONS);
export type BriefingSectionId = z.infer<typeof BriefingSectionIdSchema>;

export const BRIEFING_SECTION_TITLES: Readonly<Record<BriefingSectionId, string>> = {
  shape: 'Shape',
  shipped: 'Shipped',
  riskier: 'Riskier',
  quality: 'Quality',
  decide: 'Needs a decision',
};

export const BriefingItemSchema = z.object({
  /** Stable within a briefing: `shipped.merged`, `decide.pr-12`. What a narration cites. */
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z]+\.[a-z0-9-]+$/u),
  section: BriefingSectionIdSchema,
  tone: z.enum(['good', 'caution', 'bad', 'neutral']),
  text: z.string().min(1).max(300),
  /** Where it was read from. At least one: an uncited line is not a briefing line. */
  evidence: z.array(z.string().min(1).max(200)).min(1).max(10),
  /** A dashboard path to act on it; `null` when there is nowhere to go. */
  link: z.string().startsWith('/').max(300).nullable(),
});
export type BriefingItem = z.infer<typeof BriefingItemSchema>;

export const BriefingScopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('repository'),
    projectId: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({ kind: z.literal('portfolio'), projects: z.number().int().min(0) }),
]);
export type BriefingScope = z.infer<typeof BriefingScopeSchema>;

export const BriefingSchema = z.object({
  version: z.string().min(1),
  scope: BriefingScopeSchema,
  windowDays: z.number().int().min(1).max(366),
  generatedAt: z.iso.datetime({ offset: true }),
  shape: ShapeSchema,
  /** The briefing in one sentence, built from its own items. */
  headline: z.string().min(1).max(400),
  items: z.array(BriefingItemSchema).max(40),
});
export type Briefing = z.infer<typeof BriefingSchema>;

/** A narration of a briefing: sentences, each citing the items it rewords. */
export const NarrationSchema = z.object({
  sentences: z
    .array(z.object({ text: z.string().min(1).max(400), cites: z.array(z.string().min(1)).min(1) }))
    .min(1)
    .max(12),
});
export type Narration = z.infer<typeof NarrationSchema>;

/** `GET …/briefing`: the briefing, and its narration when one was asked for and passed. */
export const BriefingResponseSchema = z.object({
  briefing: BriefingSchema,
  /**
   * `null` when none was asked for or no model is configured. `rejected` names why a model's
   * narration was thrown away, and the briefing's own items stand in for it.
   */
  narration: z
    .discriminatedUnion('status', [
      z.object({
        status: z.literal('accepted'),
        model: z.string().min(1),
        narration: NarrationSchema,
      }),
      z.object({
        status: z.literal('rejected'),
        model: z.string().min(1),
        reason: z.string().min(1),
      }),
      z.object({ status: z.literal('unavailable'), reason: z.string().min(1) }),
    ])
    .nullable(),
});
export type BriefingResponse = z.infer<typeof BriefingResponseSchema>;
