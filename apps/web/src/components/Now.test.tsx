import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../lib/api.js';
import { MAX_ATTENTION, isNew, rankAttention } from '../lib/attention.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { AttentionSection, LAST_VISIT_KEY, type NowSources } from './Now.js';

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
    expect(ranked.items[0]?.title).toBe('checkout e2e failed');
    expect(ranked.items[0]?.action.to).toBe('/dashboard/runs/bbbbbbbb');
    expect(ranked.items.some((item) => item.title === 'api failed')).toBe(true);
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
    expect(first).toHaveTextContent('checkout e2e failed');
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
