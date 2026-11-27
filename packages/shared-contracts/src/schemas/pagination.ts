/**
 * One cursor-page contract (plan 1795712849115 task 5).
 *
 * Paged lists in the API grew one spelling each: the GitHub inbox answered `{ items,
 * nextCursor }`, the runs list answered a bare array with an `X-Next-Cursor` header, and every
 * route parsed `?limit` and `?cursor` with its own clamp. This file is the shape new paged
 * routes use, and the two existing spellings are named here rather than changed, because a
 * changed wire shape is a broken client.
 *
 *  - An object page is {@link cursorPageSchema}: `items`, and `nextCursor`, which is `null`
 *    on the last page and never absent, so a client cannot read "absent" as "more".
 *  - An array page (the runs list, kept for its existing callers) carries the next cursor in
 *    {@link NEXT_CURSOR_HEADER}, and an absent header means the last page.
 *  - A cursor is opaque: a client passes back exactly what it was given.
 */
import { z } from 'zod/v4';

/** The most items one page may carry, whatever a caller asks for. */
export const MAX_PAGE_SIZE = 100;
/** The page size when a caller asks for none. */
export const DEFAULT_PAGE_SIZE = 25;
/** Where an array-shaped list puts its next cursor. Absent on the last page. */
export const NEXT_CURSOR_HEADER = 'X-Next-Cursor';

/** An opaque cursor, as the server issued it. */
export const CursorSchema = z.string().trim().min(1).max(512);

/**
 * `?limit` and `?cursor`, as a query string carries them.
 *
 * A limit that is not a whole number falls back to the default and one out of range is
 * clamped, rather than refused: a dashboard should not fail to render because someone edited
 * a query string. A cursor that is present but empty is absent.
 */
export const CursorQuerySchema = z.object({
  limit: z
    .unknown()
    .optional()
    .transform((raw) => {
      const parsed = typeof raw === 'string' && /^\d+$/u.test(raw.trim()) ? Number(raw) : NaN;
      return Number.isFinite(parsed)
        ? Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;
    }),
  cursor: z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw.trim() === '' ? undefined : raw.trim()))
    .pipe(CursorSchema.optional()),
});
export type CursorQuery = z.infer<typeof CursorQuerySchema>;

/**
 * The page shape for an object-paged list of `item`.
 *
 * @param item the schema of one entry
 */
export function cursorPageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    // Unbounded on the way out: the server issues it, and a bound here would be a second,
    // weaker statement of what the server already guarantees.
    nextCursor: z.string().nullable(),
  });
}

/** A page of `T`, as {@link cursorPageSchema} describes it. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
