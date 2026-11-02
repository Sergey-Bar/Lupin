import { describe, expect, it } from 'vitest';
import { GRADE_FLOORS, PENALTY, analyzeRepository, type RepositoryFacts } from './github-health.js';

const CLEAN_ALERTS = { critical: 0, high: 0, medium: 0, low: 0, truncated: false };

/** A repository with nothing wrong with it. Each test changes one thing. */
function healthy(overrides: Partial<RepositoryFacts> = {}): RepositoryFacts {
  return {
    synced: true,
    openPullRequests: 4,
    stalePullRequests: 0,
    failingPullRequests: 0,
    conflictedPullRequests: 0,
    unreviewedPullRequests: 0,
    openIssues: 10,
    untriagedIssues: 0,
    state: {
      community: {
        healthPercentage: 100,
        license: true,
        codeOfConduct: true,
        contributing: true,
        issueTemplate: true,
        pullRequestTemplate: true,
        readme: true,
      },
      protection: { state: 'protected', requiresReview: true, requiresChecks: true },
      alerts: {
        dependabot: CLEAN_ALERTS,
        codeScanning: CLEAN_ALERTS,
        secretScanning: CLEAN_ALERTS,
      },
    },
    ...overrides,
  };
}

const ids = (facts: RepositoryFacts) => analyzeRepository(facts).findings.map((f) => f.id);

describe('analyzeRepository', () => {
  it('finds nothing wrong with a healthy repository and scores it 100', () => {
    expect(analyzeRepository(healthy())).toEqual({ score: 100, grade: 'A', findings: [] });
  });

  it('says nothing is known about a repository that has not been synced, instead of grading it', () => {
    const result = analyzeRepository(healthy({ synced: false, state: null }));
    expect(result.score).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.findings.map((f) => f.id)).toEqual(['not-synced']);
  });

  describe('the default branch', () => {
    it('flags an unprotected default branch as high, with the fix', () => {
      const facts = healthy();
      facts.state = {
        ...(facts.state as NonNullable<RepositoryFacts['state']>),
        protection: { state: 'unprotected' },
      };
      const finding = analyzeRepository(facts).findings.find(
        (f) => f.id === 'no-branch-protection',
      );
      expect(finding).toMatchObject({ severity: 'high', fix: 'protect-branch' });
    });

    it('flags protection that requires neither review nor checks', () => {
      const facts = healthy();
      facts.state = {
        ...(facts.state as NonNullable<RepositoryFacts['state']>),
        protection: { state: 'protected', requiresReview: false, requiresChecks: false },
      };
      expect(ids(facts)).toContain('weak-branch-protection');
    });

    it('does not call a branch unprotected when the token simply could not read protection', () => {
      const facts = healthy();
      facts.state = {
        ...(facts.state as NonNullable<RepositoryFacts['state']>),
        protection: { state: 'unavailable' },
      };
      expect(ids(facts)).toEqual(['protection-not-read']);
      expect(analyzeRepository(facts).findings[0]?.severity).toBe('info');
    });
  });

  describe('community files', () => {
    it('flags a missing license as high and other missing files as low', () => {
      const facts = healthy();
      const state = facts.state as NonNullable<RepositoryFacts['state']>;
      facts.state = {
        ...state,
        community: {
          ...(state.community as NonNullable<typeof state.community>),
          license: false,
          contributing: false,
          pullRequestTemplate: false,
        },
      };
      const found = analyzeRepository(facts).findings;
      expect(found.find((f) => f.id === 'no-license')?.severity).toBe('high');
      expect(found.find((f) => f.id === 'missing-community-files')).toMatchObject({
        severity: 'low',
        evidence: expect.stringContaining('contributing guide'),
      });
    });

    it('stays quiet about files when GitHub returned no profile', () => {
      const facts = healthy();
      facts.state = { ...(facts.state as NonNullable<RepositoryFacts['state']>), community: null };
      expect(ids(facts)).toEqual([]);
    });
  });

  describe('security alerts', () => {
    const withAlerts = (
      dependabot: object,
      codeScanning: object = CLEAN_ALERTS,
      secrets: object = CLEAN_ALERTS,
    ) => {
      const facts = healthy();
      facts.state = {
        ...(facts.state as NonNullable<RepositoryFacts['state']>),
        alerts: { dependabot, codeScanning, secretScanning: secrets } as never,
      };
      return facts;
    };

    it('treats a leaked secret as critical', () => {
      const facts = withAlerts(CLEAN_ALERTS, CLEAN_ALERTS, { ...CLEAN_ALERTS, critical: 2 });
      expect(analyzeRepository(facts).findings.find((f) => f.id === 'secret-alerts')).toMatchObject(
        {
          severity: 'critical',
          evidence: expect.stringContaining('2'),
        },
      );
    });

    it('grades dependency and code alerts by the worst severity open', () => {
      expect(
        analyzeRepository(withAlerts({ ...CLEAN_ALERTS, critical: 1 })).findings.find(
          (f) => f.id === 'dependabot-alerts',
        )?.severity,
      ).toBe('critical');
      expect(
        analyzeRepository(withAlerts({ ...CLEAN_ALERTS, high: 3 })).findings.find(
          (f) => f.id === 'dependabot-alerts',
        )?.severity,
      ).toBe('high');
      expect(ids(withAlerts({ ...CLEAN_ALERTS, medium: 4 }))).toContain('dependabot-alerts');
      expect(
        analyzeRepository(withAlerts(CLEAN_ALERTS, { ...CLEAN_ALERTS, high: 1 })).findings.find(
          (f) => f.id === 'code-scanning-alerts',
        )?.severity,
      ).toBe('high');
    });

    it('says "at least" when the first page was not the whole list', () => {
      const facts = withAlerts({ ...CLEAN_ALERTS, high: 100, truncated: true });
      expect(
        analyzeRepository(facts).findings.find((f) => f.id === 'dependabot-alerts')?.evidence,
      ).toContain('at least');
    });

    it('reports a feed the token cannot read as one informational finding, never as clean', () => {
      const facts = withAlerts({ unavailable: 'forbidden' }, { unavailable: 'not_found' });
      const found = analyzeRepository(facts).findings;
      expect(found.map((f) => f.id)).toEqual(['alerts-not-read']);
      expect(found[0]).toMatchObject({
        severity: 'info',
        evidence: expect.stringContaining('Dependabot'),
      });
    });
  });

  describe('pull requests and issues', () => {
    it('flags stale, failing, conflicted and unreviewed pull requests with their counts', () => {
      const found = analyzeRepository(
        healthy({
          stalePullRequests: 2,
          failingPullRequests: 3,
          conflictedPullRequests: 1,
          unreviewedPullRequests: 4,
        }),
      ).findings;
      expect(found.map((f) => f.id).sort()).toEqual([
        'conflicted-pull-requests',
        'failing-pull-requests',
        'stale-pull-requests',
        'unreviewed-pull-requests',
      ]);
      expect(found.find((f) => f.id === 'failing-pull-requests')?.evidence).toContain('3');
    });

    it('flags a pile of issues nobody has labelled or assigned only once it is a pile', () => {
      expect(ids(healthy({ untriagedIssues: 2 }))).toEqual([]);
      expect(ids(healthy({ untriagedIssues: 5 }))).toEqual(['untriaged-issues']);
    });
  });

  describe('the numbers behind each finding, for a client that speaks another language', () => {
    it('carries the counts as params, so the sentence can be written in any language', () => {
      const facts = healthy({
        stalePullRequests: 2,
        failingPullRequests: 3,
        conflictedPullRequests: 1,
        unreviewedPullRequests: 4,
        untriagedIssues: 7,
      });
      const params = Object.fromEntries(
        analyzeRepository(facts).findings.map((finding) => [finding.id, finding.params]),
      );
      expect(params).toMatchObject({
        'failing-pull-requests': { count: 3 },
        'conflicted-pull-requests': { count: 1 },
        'unreviewed-pull-requests': { count: 4, days: 3 },
        'stale-pull-requests': { count: 2, days: 14 },
        'untriaged-issues': { count: 7 },
      });
    });

    it('names the missing community files and the unreadable feeds by key, not by English word', () => {
      const facts = healthy();
      const state = facts.state as NonNullable<RepositoryFacts['state']>;
      facts.state = {
        ...state,
        community: {
          ...(state.community as NonNullable<typeof state.community>),
          readme: false,
          issueTemplate: false,
        },
        alerts: {
          ...state.alerts,
          dependabot: { unavailable: 'forbidden' },
          secretScanning: { unavailable: 'not_found' },
        },
      };
      const found = analyzeRepository(facts).findings;
      expect(found.find((f) => f.id === 'missing-community-files')?.params).toEqual({
        missing: ['readme', 'issueTemplate'],
      });
      expect(found.find((f) => f.id === 'alerts-not-read')?.params).toEqual({
        feeds: ['dependabot', 'secretScanning'],
      });
    });

    it('carries alert counts by severity and whether the page was the whole list', () => {
      const facts = healthy();
      const state = facts.state as NonNullable<RepositoryFacts['state']>;
      facts.state = {
        ...state,
        alerts: {
          ...state.alerts,
          codeScanning: { critical: 0, high: 2, medium: 0, low: 1, truncated: true },
        },
      };
      expect(
        analyzeRepository(facts).findings.find((f) => f.id === 'code-scanning-alerts')?.params,
      ).toEqual({
        critical: 0,
        high: 2,
        medium: 0,
        low: 1,
        truncated: true,
      });
    });
  });

  describe('the score', () => {
    it('subtracts a fixed penalty per finding by severity and never goes below zero', () => {
      const one = analyzeRepository(healthy({ failingPullRequests: 1 }));
      expect(one.score).toBe(100 - PENALTY.medium);
      const awful = healthy({
        stalePullRequests: 9,
        failingPullRequests: 9,
        conflictedPullRequests: 9,
        unreviewedPullRequests: 9,
        untriagedIssues: 90,
      });
      awful.state = {
        ...(awful.state as NonNullable<RepositoryFacts['state']>),
        protection: { state: 'unprotected' },
        alerts: {
          dependabot: { ...CLEAN_ALERTS, critical: 5 },
          codeScanning: { ...CLEAN_ALERTS, critical: 5 },
          secretScanning: { ...CLEAN_ALERTS, critical: 5 },
        },
      };
      const result = analyzeRepository(awful);
      expect(result.score).toBe(0);
      expect(result.grade).toBe('F');
    });

    it('orders findings worst first, so the first one is the one to fix', () => {
      const facts = healthy({ untriagedIssues: 9, failingPullRequests: 1 });
      facts.state = {
        ...(facts.state as NonNullable<RepositoryFacts['state']>),
        protection: { state: 'unprotected' },
      };
      const severities = analyzeRepository(facts).findings.map((f) => f.severity);
      expect(severities).toEqual(['high', 'medium', 'low']);
    });

    it('maps the score to a grade by floors that are read from one table', () => {
      expect(GRADE_FLOORS.map(([grade]) => grade)).toEqual(['A', 'B', 'C', 'D']);
      const floorsDescend = GRADE_FLOORS.every(
        ([, floor], index) => index === 0 || floor < (GRADE_FLOORS[index - 1]?.[1] ?? 0),
      );
      expect(floorsDescend).toBe(true);
    });
  });
});
