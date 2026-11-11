import { PaceReportSchema } from '@lupin/shared-contracts';
import { describe, expect, it } from 'vitest';
import { PACE_VERSION, paceReport, weekStartOf, type PaceMerge } from './pace.js';

// A Wednesday, so the week runs from Monday 2026-11-09.
const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const merge = (overrides: Partial<PaceMerge> = {}): PaceMerge => ({
  mergedAt: daysAgo(1),
  additions: 100,
  deletions: 0,
  attribution: 'human',
  testsTouched: false,
  coverage: { executable: 80, covered: 60 },
  ...overrides,
});

describe('weekStartOf', () => {
  it('is Monday 00:00 UTC, for a Monday and a Sunday', () => {
    expect(weekStartOf(NOW).toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(weekStartOf(new Date('2026-11-09T00:00:00.000Z')).toISOString()).toBe(
      '2026-11-09T00:00:00.000Z',
    );
    expect(weekStartOf(new Date('2026-11-15T23:59:00.000Z')).toISOString()).toBe(
      '2026-11-09T00:00:00.000Z',
    );
  });
});

describe('paceReport', () => {
  it('counts lines, AI share, tested share, new tests and debt per week, oldest first', () => {
    const report = paceReport({
      projectId: 'p',
      now: NOW,
      weeks: 2,
      merges: [
        merge({
          mergedAt: daysAgo(8),
          additions: 200,
          coverage: { executable: 100, covered: 100 },
        }),
        merge({ additions: 700, deletions: 300, attribution: 'agent-authored' }),
        merge({ additions: 1000, testsTouched: true, coverage: null }),
      ],
      firstSeen: [daysAgo(1), daysAgo(2), daysAgo(9), daysAgo(400)],
    });
    expect(PaceReportSchema.safeParse(report).success).toBe(true);
    expect(report).toMatchObject({ version: PACE_VERSION, status: 'measured', truncated: false });
    expect(report.weeks).toEqual([
      {
        weekStart: '2026-11-02T00:00:00.000Z',
        mergedPullRequests: 1,
        changedLines: 200,
        aiShare: 0,
        testedShare: 0,
        testsAdded: 1,
        testsPerKloc: 5,
        uncoveredLines: 0,
        unmeasuredLines: 0,
        debt: 0,
      },
      {
        weekStart: '2026-11-09T00:00:00.000Z',
        mergedPullRequests: 2,
        changedLines: 2000,
        aiShare: 0.5,
        testedShare: 0.5,
        testsAdded: 2,
        testsPerKloc: 1,
        uncoveredLines: 20,
        unmeasuredLines: 1000,
        debt: 20,
      },
    ]);
    expect(report.debt).toEqual({ uncoveredLines: 20, unmeasuredLines: 1000 });
    expect(report.headline).toBe(
      '2,000 lines changed this week (50% AI-written); 2 new tests, 1 per 1,000 lines; 20 untested changed lines merged in the window.',
    );
  });

  it('is not configured with no pull request ever read, and insufficient with one week merged', () => {
    const none = paceReport({ projectId: 'p', now: NOW, weeks: 4, merges: null, firstSeen: null });
    expect(none.status).toBe('not_configured');
    expect(none.headline).toBe(
      'Nothing merged is known yet: turn on delivery sync for this repository.',
    );
    const one = paceReport({
      projectId: 'p',
      now: NOW,
      weeks: 4,
      merges: [merge()],
      firstSeen: [],
    });
    expect(one.status).toBe('insufficient');
  });

  it('says new tests were not measured without run history, and nothing merged this week', () => {
    const blind = paceReport({
      projectId: 'p',
      now: NOW,
      weeks: 2,
      merges: [merge()],
      firstSeen: null,
    });
    expect(blind.weeks.at(-1)).toMatchObject({ testsAdded: null, testsPerKloc: null });
    expect(blind.headline).toContain('new tests were not measured');
    const quiet = paceReport({
      projectId: 'p',
      now: NOW,
      weeks: 2,
      merges: [merge({ mergedAt: daysAgo(8) })],
      firstSeen: [],
    });
    expect(quiet.headline).toBe(
      'Nothing merged this week; 20 untested changed lines merged in the window.',
    );
    expect(quiet.weeks.at(-1)).toMatchObject({ aiShare: null, testedShare: null });
  });

  it('ignores merges outside the window, clamps the week count, and keeps truncation', () => {
    const report = paceReport({
      projectId: 'p',
      now: NOW,
      weeks: 0,
      merges: [
        merge({ mergedAt: daysAgo(30) }),
        merge({ mergedAt: new Date(NOW.getTime() + 30 * DAY) }),
      ],
      firstSeen: [],
      truncated: true,
    });
    expect(report.weeks).toHaveLength(1);
    expect(report.weeks[0]?.mergedPullRequests).toBe(0);
    expect(report.truncated).toBe(true);
    expect(
      paceReport({ projectId: 'p', now: NOW, weeks: 99, merges: [], firstSeen: [] }).weeks,
    ).toHaveLength(52);
  });

  it('reads negative or impossible counts as zero, and covered past executable as fully covered', () => {
    const report = paceReport({
      projectId: 'p',
      now: NOW,
      weeks: 1,
      merges: [
        merge({ additions: -5, deletions: Number.NaN, coverage: { executable: 10, covered: 99 } }),
      ],
      firstSeen: [],
    });
    expect(report.weeks[0]).toMatchObject({ changedLines: 0, uncoveredLines: 0 });
  });
});
