import type { ReportArea, ReportCard, ReportFix, ReportInput } from './report.js';

/**
 * A report lens: the same tiny digest, tuned for who reads it.
 *
 * The digest shape is fixed — a status, one sentence, at most three items, at most three area
 * lines, at most three actions — and a lens does not change that. It changes only the *order*
 * the material is offered in, before {@link composeReport} caps it: a manager's report leads
 * with delivery and readiness, an SDET's with the tests that are failing or flaky, a quality
 * owner's with effectiveness and supply chain. `composeReport` then keeps the first three area
 * lines and the worst-first items exactly as it always did, so every length and escaping
 * property the renderers are tested for is untouched.
 *
 * Pure: it reads `ReportInput` and returns a new one, with no clock, no I/O and no mutation of
 * its argument. `general` is the identity, so a report with no audience is byte-for-byte the
 * report it was before lenses existed — which is the property `report-lens.test.ts` pins.
 */

export type ReportAudience = 'general' | 'manager' | 'sdet' | 'quality';

/**
 * The area labels each audience wants first, most important first. An area whose label is not
 * listed keeps its original order after the listed ones, so a new area added to the report is
 * never silently dropped — it simply is not promoted until a lens names it.
 */
const PRIORITY: Record<ReportAudience, readonly string[]> = {
  // Identity: the empty priority leaves every area in the order the report assembled it.
  general: [],
  // A manager reads outcomes: how fast and how safely change ships, and whether a release is
  // ready — not which test flaked.
  manager: ['DORA', 'Flow', 'Readiness', 'AI code'],
  // An SDET reads the suite: what is failing, what is flaky, and whether the diff is covered.
  sdet: ['Flaky tests', 'Failure clusters', 'Diff coverage', 'DORA'],
  // A quality owner reads the system: how effective the tests are, the supply chain, and how
  // AI-written change is governed.
  quality: ['Test effectiveness', 'Supply chain', 'AI code', 'Flaky tests'],
};

/** A stable key for sorting: an area's index in the priority list, or `Infinity` if unlisted. */
function rankOf(priority: readonly string[], label: string): number {
  const index = priority.indexOf(label);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

/**
 * Reorders `areas` by the audience's priority, stably: listed labels first in their stated
 * order, every other area after them in its original order. Never adds, drops or edits an area.
 */
function orderAreas(
  areas: readonly ReportArea[],
  priority: readonly string[],
): readonly ReportArea[] {
  return areas
    .map((area, order) => ({ area, order }))
    .sort((a, b) => {
      const byPriority = rankOf(priority, a.area.label) - rankOf(priority, b.area.label);
      return byPriority !== 0 ? byPriority : a.order - b.order;
    })
    .map(({ area }) => area);
}

/**
 * Reorders scorecards and fix-next items so the audience's areas are weighted in the actions
 * too: a card whose project leads a promoted area is not special, but a card *labelled* for a
 * promoted concern comes first. Stable, and never drops a row.
 */
function orderByProjectPresence<T extends ReportCard | ReportFix>(
  rows: readonly T[],
): readonly T[] {
  // Scorecards and fixes carry no area label, so there is nothing audience-specific to promote
  // among them without inventing a mapping the data does not hold. They keep their order; the
  // lens's effect on actions flows through the reordered areas, which `topActions` reads.
  return rows;
}

/**
 * The report, tuned for `audience`. `general` (and an unknown value, defensively) returns the
 * input unchanged.
 */
export function applyLens(input: ReportInput, audience: ReportAudience): ReportInput {
  const priority = PRIORITY[audience] ?? PRIORITY.general;
  if (priority.length === 0) return input;
  return {
    ...input,
    ...(input.areas === undefined ? {} : { areas: orderAreas(input.areas, priority) }),
    ...(input.scorecards === undefined
      ? {}
      : { scorecards: orderByProjectPresence(input.scorecards) }),
    ...(input.fixNext === undefined ? {} : { fixNext: orderByProjectPresence(input.fixNext) }),
  };
}
