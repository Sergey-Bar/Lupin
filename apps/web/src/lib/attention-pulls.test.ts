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
});
