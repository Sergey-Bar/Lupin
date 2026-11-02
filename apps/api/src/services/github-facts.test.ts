import { describe, expect, it } from 'vitest';
import {
  alertCounts,
  checksRollup,
  communityFacts,
  protectionFacts,
  reviewDecision,
} from './github-facts.js';

describe('reviewDecision', () => {
  const review = (login: string, state: string, at: string) => ({
    user: { login },
    state,
    submitted_at: `2026-10-01T${at}:00Z`,
  });

  it('is review_required until a human approves', () => {
    expect(reviewDecision([], 'alice')).toBe('review_required');
    expect(reviewDecision([review('bob', 'COMMENTED', '10')], 'alice')).toBe('review_required');
  });

  it('is approved once a reviewer other than the author approves', () => {
    expect(reviewDecision([review('bob', 'APPROVED', '10')], 'alice')).toBe('approved');
    // The author approving their own pull request, or a bot doing it, is not a review.
    expect(reviewDecision([review('alice', 'APPROVED', '10')], 'alice')).toBe('review_required');
    expect(reviewDecision([review('ci[bot]', 'APPROVED', '10')], 'alice')).toBe('review_required');
  });

  it("counts only each reviewer's latest word", () => {
    const flipped = [review('bob', 'CHANGES_REQUESTED', '09'), review('bob', 'APPROVED', '11')];
    expect(reviewDecision(flipped, 'alice')).toBe('approved');
    const reverted = [review('bob', 'APPROVED', '09'), review('bob', 'CHANGES_REQUESTED', '11')];
    expect(reviewDecision(reverted, 'alice')).toBe('changes_requested');
  });

  it('lets one open objection outweigh another reviewer’s approval', () => {
    const split = [review('bob', 'APPROVED', '09'), review('carol', 'CHANGES_REQUESTED', '10')];
    expect(reviewDecision(split, 'alice')).toBe('changes_requested');
  });

  it('treats a dismissed review as no review, and ignores a pending one', () => {
    expect(
      reviewDecision(
        [review('bob', 'CHANGES_REQUESTED', '09'), review('bob', 'DISMISSED', '10')],
        'alice',
      ),
    ).toBe('review_required');
    expect(
      reviewDecision([{ user: { login: 'bob' }, state: 'APPROVED', submitted_at: null }], 'alice'),
    ).toBe('review_required');
  });
});

describe('checksRollup', () => {
  const run = (status: string, conclusion: string | null = null) => ({ status, conclusion });

  it('is null when there are no checks, which is not the same as passing', () => {
    expect(checksRollup([])).toBeNull();
  });

  it('is success only when every check finished well', () => {
    expect(
      checksRollup([
        run('completed', 'success'),
        run('completed', 'skipped'),
        run('completed', 'neutral'),
      ]),
    ).toBe('success');
  });

  it('is pending while anything is still running', () => {
    expect(checksRollup([run('completed', 'success'), run('in_progress')])).toBe('pending');
    expect(checksRollup([run('queued')])).toBe('pending');
  });

  it('is failure for any failed outcome, even while others run', () => {
    for (const conclusion of [
      'failure',
      'timed_out',
      'cancelled',
      'action_required',
      'startup_failure',
    ]) {
      expect(checksRollup([run('completed', conclusion), run('in_progress')]), conclusion).toBe(
        'failure',
      );
    }
  });
});

describe('alertCounts', () => {
  it('counts by severity and says when the page was not the whole list', () => {
    const items = [
      { security_advisory: { severity: 'critical' } },
      { security_advisory: { severity: 'high' } },
      { security_advisory: { severity: 'high' } },
      { security_advisory: { severity: 'low' } },
    ];
    expect(alertCounts({ items, nextPage: null }, 'dependabot')).toEqual({
      critical: 1,
      high: 2,
      medium: 0,
      low: 1,
      truncated: false,
    });
    expect(alertCounts({ items, nextPage: 2 }, 'dependabot')).toMatchObject({ truncated: true });
  });

  it('reads a code-scanning alert’s security severity, then its rule severity', () => {
    const items = [
      { rule: { security_severity_level: 'critical', severity: 'warning' } },
      { rule: { severity: 'error' } },
      { rule: { severity: 'warning' } },
      { rule: { severity: 'note' } },
      { rule: {} },
    ];
    expect(alertCounts({ items, nextPage: null }, 'codeScanning')).toEqual({
      critical: 1,
      high: 1,
      medium: 2,
      low: 1,
      truncated: false,
    });
  });

  it('counts every secret-scanning alert as critical: a leaked credential has no lower grade', () => {
    expect(alertCounts({ items: [{}, {}], nextPage: null }, 'secretScanning')).toMatchObject({
      critical: 2,
      high: 0,
    });
  });

  it('reports a feed the token cannot read as unavailable, never as zero', () => {
    expect(
      alertCounts({ items: [], nextPage: null, unavailable: 'forbidden' }, 'dependabot'),
    ).toEqual({ unavailable: 'forbidden' });
  });
});

describe('protectionFacts', () => {
  it('reads what a protected branch requires', () => {
    expect(
      protectionFacts({
        required_pull_request_reviews: { required_approving_review_count: 1 },
        required_status_checks: { contexts: [] },
      }),
    ).toEqual({ state: 'protected', requiresReview: true, requiresChecks: true });
    expect(protectionFacts({ enforce_admins: { enabled: true } })).toEqual({
      state: 'protected',
      requiresReview: false,
      requiresChecks: false,
    });
  });

  it('is unprotected only when GitHub says so, and unavailable when the token cannot tell', () => {
    expect(protectionFacts({ unavailable: 'not_found', message: 'Branch not protected' })).toEqual({
      state: 'unprotected',
    });
    expect(protectionFacts({ unavailable: 'not_found', message: 'Not Found' })).toEqual({
      state: 'unavailable',
    });
    expect(protectionFacts({ unavailable: 'forbidden' })).toEqual({ state: 'unavailable' });
  });
});

describe('communityFacts', () => {
  it('keeps the booleans a health view uses', () => {
    expect(
      communityFacts({
        health_percentage: 71,
        files: {
          license: { key: 'mit' },
          code_of_conduct: null,
          contributing: { url: 'x' },
          issue_template: null,
          pull_request_template: { url: 'y' },
          readme: { url: 'z' },
        },
      }),
    ).toEqual({
      healthPercentage: 71,
      license: true,
      codeOfConduct: false,
      contributing: true,
      issueTemplate: false,
      pullRequestTemplate: true,
      readme: true,
    });
  });

  it('is null when GitHub answered with something else', () => {
    expect(communityFacts({ unavailable: 'forbidden' })).toBeNull();
    expect(communityFacts(null)).toBeNull();
  });
});
