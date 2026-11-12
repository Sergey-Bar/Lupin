import { pullItems, rankAttention } from './attention.js';

const pull = (overrides: Record<string, unknown>) =>
  ({
    id: 'p',
    projectId: 'proj',
    projectName: 'Lupin',
    repository: 'acme/shop',
    number: 42,
    title: 'Express checkout',
    author: 'dev',
    state: 'open',
    draft: false,
    htmlUrl: null,
    headBranch: 'feat/express-checkout',
    baseBranch: 'main',
    labels: [],
    reviewDecision: null,
    checksState: 'success',
    mergeableState: null,
    requestedReviewers: [],
    openedAt: '2026-11-08T00:00:00.000Z',
    lastActivityAt: '2026-11-09T00:00:00.000Z',
    additions: 1,
    deletions: 1,
    headSha: null,
    ...overrides,
  }) as never;

describe('pullItems', () => {
  it('names a pull request blocked by failing checks, and one that needs changes', () => {
    const items = pullItems([
      pull({ id: 'a', number: 42, checksState: 'failure' }),
      pull({ id: 'b', number: 7, reviewDecision: 'changes_requested' }),
      pull({ id: 'c', number: 9 }),
      pull({ id: 'd', number: 3, checksState: 'failure', draft: true }),
    ]);
    expect(items.map((item) => [item.title, item.severity])).toEqual([
      ['PR #42 is blocked by failing checks', 'bad'],
      ['PR #7 needs changes', 'caution'],
    ]);
    expect(items[0]?.detail).toBe('acme/shop · Express checkout');
    expect(items[0]?.action.to).toBe('/dashboard/prs?project=proj');
  });

  it('feeds the focus beside failing runs', () => {
    const ranked = rankAttention({
      runs: [],
      portfolio: null,
      deliveries: [],
      pulls: [pull({ checksState: 'failure' })],
      now: new Date('2026-11-09T12:00:00.000Z'),
    });
    expect(ranked.items[0]?.title).toBe('PR #42 is blocked by failing checks');
  });

  const risk = (level: string, current = true) => ({
    level,
    score: level === 'critical' ? 80 : 50,
    headSha: 'b'.repeat(40),
    assessedAt: '2026-11-10T00:00:00.000Z',
    current,
  });

  it('puts a high or critical change risk first, once per pull request, linking to why', () => {
    const items = pullItems([
      pull({ id: 'a', number: 42, checksState: 'failure', risk: risk('critical') }),
      pull({ id: 'b', number: 7, risk: risk('high') }),
    ]);
    expect(items.map((item) => [item.title, item.severity])).toEqual([
      ['PR #42: critical risk (80 points)', 'bad'],
      ['PR #7: high risk (50 points)', 'caution'],
    ]);
    expect(items[0]?.action).toEqual({ label: 'See why', to: '/dashboard/prs/proj/42' });
    expect(items[0]?.at).toBe('2026-11-10T00:00:00.000Z');
  });

  it('says nothing about a risk assessed at an older head, a low one, or an unknown one', () => {
    const items = pullItems([
      pull({ id: 'a', number: 1, risk: risk('critical', false) }),
      pull({ id: 'b', number: 2, risk: risk('low') }),
      pull({ id: 'c', number: 3, risk: risk('unknown') }),
      pull({ id: 'd', number: 4, risk: null }),
      pull({ id: 'e', number: 5, risk: risk('critical'), draft: true }),
    ]);
    expect(items).toEqual([]);
  });
});
