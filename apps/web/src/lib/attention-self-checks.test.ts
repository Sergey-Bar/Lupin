import { rankAttention } from './attention.js';

const now = new Date('2026-11-26T12:00:00.000Z');

describe('self-checks in what needs you (plan 1795712849115 task 16)', () => {
  it('ranks a self-check beside everything else, with its fix as the action', () => {
    const { items, total } = rankAttention({
      runs: [],
      portfolio: null,
      deliveries: [],
      selfChecks: [
        {
          id: 'self-results-silent',
          severity: 'caution',
          title: 'No test results for 3 days',
          detail: 'CI may have stopped sending them',
          fix: { label: 'Check how results are sent', to: '/dashboard/setup' },
          at: '2026-11-23T12:00:00.000Z',
        },
        {
          id: 'self-runner-offline',
          severity: 'bad',
          title: 'Runner offline for 4 min',
          detail: '1 queued job is waiting',
          fix: { label: 'Open runners', to: '/dashboard/runner' },
          at: '2026-11-26T11:56:00.000Z',
        },
      ],
      now,
    });
    expect(total).toBe(2);
    expect(items[0]).toMatchObject({
      id: 'self-runner-offline',
      title: 'Runner offline for 4 min',
      action: { label: 'Open runners', to: '/dashboard/runner' },
    });
    expect(items[1]?.severity).toBe('caution');
  });

  it('adds nothing when the install noticed nothing', () => {
    expect(rankAttention({ runs: [], portfolio: null, deliveries: [], now }).total).toBe(0);
  });
});
