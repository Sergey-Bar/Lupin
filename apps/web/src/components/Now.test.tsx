import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../lib/api.js';
import { MAX_ATTENTION, isNew, rankAttention } from '../lib/attention.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { AttentionSection, LAST_VISIT_KEY, type NowSources } from './Now.js';
import { commandStore } from '../hooks/useCommandActions.js';

const NOW = new Date('2026-10-25T12:00:00.000Z');

function run(overrides: Partial<Run>): Run {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    suite: 'checkout e2e',
    testType: 'browser',
    branch: 'main',
    phase: 'complete',
    outcome: 'passed',
    createdAt: '2026-10-25T11:00:00.000Z',
    startedAt: '2026-10-25T11:00:00.000Z',
    completedAt: '2026-10-25T11:05:00.000Z',
    ...overrides,
  } as Run;
}

const entry = (overrides: Record<string, unknown>) =>
  ({
    projectId: 'p1',
    slug: 'svc',
    name: 'Service',
    letter: 'B',
    score: 80,
    incomplete: false,
    limiter: null,
    trend: 0,
    worst: null,
    lastReportAt: '2026-10-25T10:00:00.000Z',
    ...overrides,
  }) as never;

describe('rankAttention', () => {
  it('drops a branch whose newest finished run passed, and ignores a queued retry behind a red one', () => {
    const fixed = rankAttention({
      runs: [
        run({ id: 'r1', branch: 'main', outcome: 'failed', createdAt: '2026-10-25T09:00:00.000Z' }),
        run({ id: 'g1', branch: 'main', outcome: 'passed', createdAt: '2026-10-25T10:00:00.000Z' }),
        run({
          id: 'r2',
          branch: 'feat/x',
          outcome: 'failed',
          createdAt: '2026-10-25T09:00:00.000Z',
        }),
        run({
          id: 'q2',
          branch: 'feat/x',
          phase: 'queued',
          outcome: null,
          createdAt: '2026-10-25T11:00:00.000Z',
        }),
      ],
      portfolio: { projects: [] } as never,
      deliveries: [],
      now: NOW,
    });
    expect(fixed.items.map((item) => item.id)).toEqual(['run-failed-r2']);
  });
  it('names a failure by its branch and how many tests broke, one item per branch', () => {
    const ranked = rankAttention({
      runs: [
        run({
          id: 'a'.repeat(8),
          suite: null,
          testType: 'browser',
          branch: 'feat/express-checkout',
          outcome: 'failed',
          summary: { total: 16, passed: 14, failed: 2 } as Run['summary'],
          createdAt: '2026-10-25T11:30:00.000Z',
        }),
        run({
          id: 'b'.repeat(8),
          suite: null,
          testType: 'browser',
          branch: 'feat/express-checkout',
          outcome: 'failed',
          createdAt: '2026-10-25T09:00:00.000Z',
        }),
        run({
          id: 'c'.repeat(8),
          suite: null,
          testType: 'browser',
          branch: 'main',
          outcome: 'failed',
          summary: { total: 16, passed: 15, failed: 1 } as Run['summary'],
          createdAt: '2026-10-25T10:00:00.000Z',
        }),
      ],
      portfolio: null,
      deliveries: [],
      now: NOW,
    });
    expect(ranked.items.map((item) => item.title)).toEqual([
      '2 tests failing on feat/express-checkout',
      '1 test failing on main',
    ]);
  });
  it('puts failures first, one per suite, newest first, then cautions', () => {
    const ranked = rankAttention({
      runs: [
        run({
          id: 'a'.repeat(8),
          outcome: 'failed',
          createdAt: '2026-10-25T09:00:00.000Z',
          completedAt: '2026-10-25T09:05:00.000Z',
        }),
        run({ id: 'b'.repeat(8), outcome: 'failed', createdAt: '2026-10-25T11:00:00.000Z' }),
        run({ id: 'c'.repeat(8), outcome: 'blocked', suite: null, testType: 'api', branch: null }),
        run({
          id: 'd'.repeat(8),
          phase: 'running',
          outcome: null,
          startedAt: '2026-10-25T09:00:00.000Z',
        }),
        run({
          id: 'e'.repeat(8),
          phase: 'running',
          outcome: null,
          startedAt: '2026-10-25T11:55:00.000Z',
        }),
        run({ id: 'f'.repeat(8) }),
      ],
      portfolio: {
        projects: [
          entry({ projectId: 'p1', letter: 'D', limiter: 'Limited by Security' }),
          entry({ projectId: 'p2', name: 'Web', letter: 'B', trend: -3, lastReportAt: null }),
          entry({ projectId: 'p3', name: 'Ok', letter: 'A' }),
        ],
      },
      deliveries: [
        {
          id: 'd1',
          status: 'failed',
          errorCode: 'telegram_rejected_401',
          scheduledFor: '2026-10-25T09:00:00.000Z',
        } as never,
        {
          id: 'd2',
          status: 'failed',
          errorCode: null,
          scheduledFor: '2026-10-24T09:00:00.000Z',
        } as never,
      ],
      now: NOW,
    });
    expect(ranked.total).toBe(6);
    expect(ranked.items).toHaveLength(MAX_ATTENTION);
    expect(ranked.items.map((item) => item.severity)).toEqual([
      'bad',
      'bad',
      'bad',
      'caution',
      'caution',
    ]);
    expect(ranked.items[0]?.title).toBe('main is failing');
    expect(ranked.items[0]?.action.to).toBe('/dashboard/runs/bbbbbbbb');
    expect(ranked.items.some((item) => item.title === 'api is failing')).toBe(true);
    expect(ranked.items.some((item) => item.title === 'Service is graded D')).toBe(true);
  });

  it('says how many reports did not arrive, and names a stuck run', () => {
    const ranked = rankAttention({
      runs: [run({ phase: 'running', outcome: null, startedAt: '2026-10-25T09:00:00.000Z' })],
      portfolio: null,
      deliveries: [
        {
          id: 'd1',
          status: 'failed',
          errorCode: null,
          scheduledFor: '2026-10-25T09:00:00.000Z',
        } as never,
        {
          id: 'd2',
          status: 'failed',
          errorCode: null,
          scheduledFor: '2026-10-24T09:00:00.000Z',
        } as never,
      ],
      now: NOW,
    });
    expect(ranked.items.map((item) => item.title)).toEqual([
      'checkout e2e has been running over an hour',
      '2 reports did not arrive',
    ]);
    expect(ranked.items[1]?.detail).toBe('Delivery failed');
    expect(
      rankAttention({
        runs: [],
        portfolio: null,
        deliveries: [
          {
            id: 'x',
            status: 'failed',
            errorCode: 'e',
            scheduledFor: '2026-10-25T09:00:00.000Z',
          } as never,
        ],
        now: NOW,
      }).items[0]?.title,
    ).toBe('A report did not arrive');
  });

  it('marks only what happened since the last visit', () => {
    const [item] = rankAttention({
      runs: [run({ outcome: 'failed' })],
      portfolio: null,
      deliveries: [],
      now: NOW,
    }).items;
    expect(item && isNew(item, '2026-10-25T10:00:00.000Z')).toBe(true);
    expect(item && isNew(item, '2026-10-25T11:30:00.000Z')).toBe(false);
    expect(item && isNew(item, null)).toBe(false);
  });
});

function sources(overrides: Partial<NowSources> = {}): NowSources {
  return {
    runs: vi.fn(async () => [run({ outcome: 'failed' })]),
    portfolio: vi.fn(async () => ({ projects: [] })),
    deliveries: vi.fn(async () => []),
    ...overrides,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe('AttentionSection, as one focus', () => {
  const many = Array.from({ length: 6 }, (_, index) =>
    run({
      id: `${String(index)}`.repeat(8),
      suite: `suite ${String(index)}`,
      branch: `feat/branch-${String(index)}`,
      outcome: 'failed',
      createdAt: `2026-10-25T0${String(index)}:00:00.000Z`,
    }),
  );

  it('gives one thing first, with its one action as the primary button', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const { container } = render(
      <AttentionSection sources={sources()} navigate={navigate} now={() => NOW} />,
    );
    const first = await screen.findByTestId('focus-first');
    expect(first).toHaveTextContent('main is failing');
    await user.click(screen.getByRole('button', { name: 'Open run' }));
    expect(navigate).toHaveBeenCalledWith('/dashboard/runs/00000000-0000-4000-8000-000000000001');
    expect(localStorage.getItem(LAST_VISIT_KEY)).toBe(NOW.toISOString());
    await expectNoBlockingAxeViolations(container);
  });

  it('shows at most two next, and folds the rest away until asked', async () => {
    render(
      <AttentionSection
        sources={sources({ runs: vi.fn(async () => many) })}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    await screen.findByTestId('focus-first');
    expect(screen.getAllByTestId(/^focus-next-/u)).toHaveLength(2);
    const rest = screen.getByTestId('focus-rest');
    expect(rest.tagName).toBe('DETAILS');
    expect(rest).not.toHaveAttribute('open');
    expect(rest).toHaveTextContent('3 more when you are ready');
  });

  it('opens the first thing from the command palette', async () => {
    const navigate = vi.fn();
    render(<AttentionSection sources={sources()} navigate={navigate} now={() => NOW} />);
    await screen.findByTestId('focus-first');
    const action = commandStore.getActions().find((entry) => entry.id === 'now-open-first');
    expect(action?.label).toBe('Open: main is failing');
    action?.onSelect();
    expect(navigate).toHaveBeenCalledWith('/dashboard/runs/00000000-0000-4000-8000-000000000001');
  });

  it('lets focus mode leave only the first thing: the rest is secondary', async () => {
    render(
      <AttentionSection
        sources={sources({ runs: vi.fn(async () => many) })}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    const first = await screen.findByTestId('focus-first');
    expect(first.closest('[data-chrome="secondary"]')).toBeNull();
    expect(screen.getByRole('list', { name: 'Then' })).toHaveAttribute('data-chrome', 'secondary');
    expect(screen.getByTestId('focus-rest')).toHaveAttribute('data-chrome', 'secondary');
  });

  it('opens a next item with its own button', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(
      <AttentionSection
        sources={sources({ runs: vi.fn(async () => many) })}
        navigate={navigate}
        now={() => NOW}
      />,
    );
    await screen.findByTestId('focus-first');
    const [next] = screen.getAllByTestId(/^focus-next-/u);
    const target = (next as HTMLElement).dataset['testid']!.replace('focus-next-run-failed-', '');
    await user.click(within(next as HTMLElement).getByRole('button', { name: 'Open run' }));
    expect(navigate).toHaveBeenCalledWith(`/dashboard/runs/${target}`);
  });

  it('says it in one calm sentence, and marks what is new since last time', async () => {
    localStorage.setItem(LAST_VISIT_KEY, '2026-10-25T10:00:00.000Z');
    render(<AttentionSection sources={sources()} navigate={vi.fn()} now={() => NOW} />);
    expect(await screen.findByTestId('focus-sentence')).toHaveTextContent(
      'One thing needs you. 1 is new since your last visit.',
    );
    expect(screen.getByText('new')).toBeTruthy();
  });

  it('says all clear, and nothing else, when nothing needs you', async () => {
    render(
      <AttentionSection
        sources={sources({ runs: vi.fn(async () => []) })}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    expect(await screen.findByTestId('now-clear')).toHaveTextContent('All clear');
    expect(screen.queryByTestId('focus-first')).toBeNull();
  });

  it('offers to act, not just to look: one click retries a failed run and says where it went', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const retryRun = vi.fn(async () => ({ id: 'retry-1234' }));
    render(
      <AttentionSection sources={{ ...sources(), retryRun }} navigate={navigate} now={() => NOW} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Retry now' }));
    expect(retryRun).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', 'all');
    expect(await screen.findByRole('status')).toHaveTextContent('Retry queued');
    await user.click(screen.getByRole('button', { name: 'Watch it' }));
    expect(navigate).toHaveBeenCalledWith('/dashboard/runs/retry-1234');
  });

  it('retries only what broke when the run says which tests failed', async () => {
    const user = userEvent.setup();
    const retryRun = vi.fn(async () => ({ id: 'retry-5678' }));
    const failing = run({
      outcome: 'failed',
      tests: [
        { id: 't1', title: 'pays', status: 'failed' },
        { id: 't2', title: 'ships', status: 'timed_out' },
        { id: 't3', title: 'logs in', status: 'passed' },
      ] as Run['tests'],
    });
    render(
      <AttentionSection
        sources={{ ...sources({ runs: vi.fn(async () => [failing]) }), retryRun }}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Retry 2 failed tests' }));
    expect(retryRun).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', 'failed');
  });

  it('says so when the automatic action is refused, and keeps the manual one', async () => {
    const user = userEvent.setup();
    const retryRun = vi.fn(async () => Promise.reject(new Error('Runner offline')));
    render(
      <AttentionSection sources={{ ...sources(), retryRun }} navigate={vi.fn()} now={() => NOW} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Retry now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Runner offline');
    expect(screen.getByRole('button', { name: 'Open run' })).toBeInTheDocument();
  });

  it('offers no automatic action when the page was given no way to take one', async () => {
    render(<AttentionSection sources={sources()} navigate={vi.fn()} now={() => NOW} />);
    await screen.findByTestId('focus-first');
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull();
  });
  it('says when a source could not be read', async () => {
    render(
      <AttentionSection
        sources={sources({ portfolio: vi.fn(async () => Promise.reject(new Error('offline'))) })}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    expect(await screen.findByText(/could not be read/u)).toBeTruthy();
  });

  it('shows a loading state, and ignores an answer after unmount', async () => {
    let resolve: (value: Run[]) => void = () => undefined;
    const slow = sources({ runs: vi.fn(() => new Promise<Run[]>((done) => (resolve = done))) });
    const { unmount } = render(<AttentionSection sources={slow} navigate={vi.fn()} />);
    expect(screen.getByTestId('now-loading')).toBeTruthy();
    unmount();
    resolve([]);
    await waitFor(() => expect(slow.runs).toHaveBeenCalled());
    expect(localStorage.getItem(LAST_VISIT_KEY)).toBeNull();
  });
});
