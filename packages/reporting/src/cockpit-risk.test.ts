import { describe, expect, it } from 'vitest';
import {
  LARGE_CHANGE_LINES,
  RISK_LOOKBACK_DAYS,
  riskSignals,
  type CockpitRiskPullRequest,
} from './cockpit-risk.js';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);
const repository = { owner: 'octo', repo: 'service' };

function pr(over: Partial<CockpitRiskPullRequest> = {}): CockpitRiskPullRequest {
  return {
    number: 1,
    title: 'Change',
    state: 'merged',
    draft: false,
    baseBranch: 'main',
    openedAt: daysAgo(3),
    mergedAt: daysAgo(2),
    additions: 10,
    deletions: 5,
    testsTouched: true,
    humanApprovalCount: 1,
    attribution: 'human',
    ...over,
  };
}

const signals = (list: CockpitRiskPullRequest[], branch = 'main') =>
  riskSignals({ pullRequests: list, branch, now: NOW, repository });

describe('riskSignals', () => {
  it('says nothing about a reviewed, tested, human change', () => {
    expect(signals([pr()])).toEqual({ total: 0, items: [] });
  });

  it('flags a large change with no test file, with the numbers in the sentence', () => {
    const result = signals([
      pr({ additions: LARGE_CHANGE_LINES, deletions: 0, testsTouched: false }),
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: 'large_change_without_tests',
      number: 1,
      url: 'https://github.com/octo/service/pull/1',
    });
    expect(result.items[0]?.detail).toContain(`${String(LARGE_CHANGE_LINES)} lines`);
  });

  it('does not flag a change one line under the limit, or a large one that touched tests', () => {
    expect(
      signals([pr({ additions: LARGE_CHANGE_LINES - 1, deletions: 0, testsTouched: false })]).total,
    ).toBe(0);
    expect(signals([pr({ additions: 5000, testsTouched: true })]).total).toBe(0);
  });

  it('flags a merge with no human approval, and not one with an approval', () => {
    expect(signals([pr({ humanApprovalCount: 0 })]).items[0]?.kind).toBe(
      'merged_without_human_approval',
    );
    expect(signals([pr({ humanApprovalCount: 1 })]).total).toBe(0);
  });

  it('flags an open AI-attributed change awaiting a person, for both AI attributions', () => {
    for (const attribution of ['agent-authored', 'ai-assisted'] as const) {
      const result = signals([
        pr({ state: 'open', mergedAt: null, humanApprovalCount: 0, attribution }),
      ]);
      expect(result.items[0]?.kind).toBe('ai_change_awaiting_human');
    }
  });

  it('never treats an unattributed or human change as AI', () => {
    for (const attribution of ['unknown', 'human'] as const) {
      expect(
        signals([pr({ state: 'open', mergedAt: null, humanApprovalCount: 0, attribution })]).total,
      ).toBe(0);
    }
  });

  it('ignores drafts, closed-unmerged pull requests and other branches', () => {
    const open = {
      state: 'open',
      mergedAt: null,
      humanApprovalCount: 0,
      attribution: 'ai-assisted',
    };
    expect(signals([pr({ ...open, state: 'open', draft: true } as never)]).total).toBe(0);
    expect(signals([pr({ ...open, state: 'closed' } as never)]).total).toBe(0);
    expect(signals([pr({ humanApprovalCount: 0, baseBranch: 'release' })]).total).toBe(0);
  });

  it('ignores a merge older than the lookback, and keeps one just inside it', () => {
    expect(
      signals([pr({ humanApprovalCount: 0, mergedAt: daysAgo(RISK_LOOKBACK_DAYS + 1) })]).total,
    ).toBe(0);
    expect(
      signals([pr({ humanApprovalCount: 0, mergedAt: daysAgo(RISK_LOOKBACK_DAYS - 1) })]).total,
    ).toBe(1);
  });

  it('reports one item per kind a pull request matches, counts all, and lists the newest ten', () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      pr({ number: index + 1, humanApprovalCount: 0, mergedAt: daysAgo(1 + index * 0.5) }),
    );
    const result = signals(many);
    expect(result.total).toBe(14);
    expect(result.items).toHaveLength(10);
    expect(result.items[0]?.number).toBe(1);
    const both = signals([pr({ humanApprovalCount: 0, additions: 900, testsTouched: false })]);
    expect(both.items.map((item) => item.kind).sort()).toEqual([
      'large_change_without_tests',
      'merged_without_human_approval',
    ]);
  });

  it('has no link without a repository, and truncates a long title', () => {
    const result = riskSignals({
      pullRequests: [pr({ humanApprovalCount: 0, title: 'x'.repeat(400) })],
      branch: 'main',
      now: NOW,
      repository: null,
    });
    expect(result.items[0]?.url).toBeNull();
    expect(result.items[0]?.title.length).toBeLessThanOrEqual(120);
  });
});
