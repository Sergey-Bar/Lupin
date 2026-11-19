import { describe, expect, it } from 'vitest';
import type { RepoScan } from '@lupin/shared-contracts';
import { meanCoverage } from './scan-history-service.js';

type Report = RepoScan['reports'][number];

const coverage = (metrics: Record<string, number>): Report =>
  ({
    path: 'c',
    kind: 'coverage',
    format: 'lcov',
    headline: '',
    metrics,
    status: 'good',
  }) as Report;

describe('meanCoverage (REL-16)', () => {
  it('weighs reports by their lines, so a small package does not count as much as a large one', () => {
    const scan = {
      reports: [
        coverage({ lines: 100, linesFound: 10, linesHit: 10 }),
        coverage({ lines: 50, linesFound: 990, linesHit: 495 }),
      ],
    };
    // 505 of 1000 lines, not the 75% a plain mean of 100 and 50 says.
    expect(meanCoverage(scan)).toBe(50.5);
  });

  it('falls back to the plain mean when any report has no line counts', () => {
    expect(
      meanCoverage({
        reports: [coverage({ lines: 100, linesFound: 10, linesHit: 10 }), coverage({ lines: 50 })],
      }),
    ).toBe(75);
  });

  it('is null with no coverage report', () => {
    expect(meanCoverage({ reports: [] })).toBeNull();
  });
});
