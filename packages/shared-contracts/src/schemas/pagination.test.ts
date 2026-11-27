import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
  CursorQuerySchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorPageSchema,
} from './pagination.js';
import { GithubIssuePageSchema, GithubPullPageSchema } from './github.js';

describe('CursorQuerySchema', () => {
  it.each([
    [undefined, DEFAULT_PAGE_SIZE],
    ['', DEFAULT_PAGE_SIZE],
    ['ten', DEFAULT_PAGE_SIZE],
    ['-4', DEFAULT_PAGE_SIZE],
    ['2.5', DEFAULT_PAGE_SIZE],
    ['0', 1],
    ['7', 7],
    [' 12 ', 12],
    ['100000', MAX_PAGE_SIZE],
  ])('reads limit %j as %i', (limit, expected) => {
    expect(CursorQuerySchema.parse({ limit }).limit).toBe(expected);
  });

  it('treats an empty or blank cursor as absent, and trims a real one', () => {
    expect(CursorQuerySchema.parse({ cursor: '' }).cursor).toBeUndefined();
    expect(CursorQuerySchema.parse({ cursor: '   ' }).cursor).toBeUndefined();
    expect(CursorQuerySchema.parse({ cursor: ' abc ' }).cursor).toBe('abc');
  });

  it('refuses a cursor no server would have issued', () => {
    expect(CursorQuerySchema.safeParse({ cursor: 'x'.repeat(513) }).success).toBe(false);
  });
});

describe('cursorPageSchema', () => {
  const Page = cursorPageSchema(z.object({ id: z.string() }));

  it('accepts a last page with a null cursor', () => {
    expect(Page.parse({ items: [{ id: 'a' }], nextCursor: null })).toEqual({
      items: [{ id: 'a' }],
      nextCursor: null,
    });
  });

  it('refuses an absent cursor, so "absent" cannot be read as "more"', () => {
    expect(Page.safeParse({ items: [] }).success).toBe(false);
  });

  it('refuses an item of the wrong shape', () => {
    expect(Page.safeParse({ items: [{ id: 1 }], nextCursor: null }).success).toBe(false);
  });

  it('is the shape the GitHub inbox pages already answered', () => {
    for (const schema of [GithubPullPageSchema, GithubIssuePageSchema]) {
      expect(schema.safeParse({ items: [], nextCursor: 'c1' }).success).toBe(true);
      expect(schema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    }
  });
});
