/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { testItems, testVerdict, InsightsPage } from './insights';
import {
  makeApi,
  makeTrend,
  makeHistory,
  makeInsights,
  makeQa,
  makeReadiness,
  TEST_PROJECT,
} from '../../test-utils';
import type { QaClient } from '../../lib/qa-client';
import type { ApiClient } from '../../lib/api';

function renderInsights(qa: QaClient, api: ApiClient = makeApi()) {
  const rootRoute = createRootRoute({ component: () => <InsightsPage qa={qa} api={api} /> });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard/insights'] }) });
  return render(<RouterProvider router={router} />);
}

describe('the insights page', () => {
  it('leads with readiness, flakiness, recovery and the slowest test', async () => {
    renderInsights(makeQa());
    await waitFor(() => expect(screen.getByTestId('insights-flaky')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Tests' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Failing' })).toHaveTextContent(
      '2 flaky tests need a decision.',
    );
    expect(screen.getByTestId('insight-readiness')).toHaveTextContent('Caution');
    expect(screen.getByTestId('insight-readiness')).toHaveAttribute('data-hero', '');
    expect(screen.getByTestId('insight-flaky')).toHaveTextContent('2');
    expect(screen.getByTestId('insight-flaky')).toHaveTextContent('worst: logs in');
    expect(screen.getByTestId('insight-mttr')).toHaveTextContent('red since');
    expect(screen.getByTestId('insight-slowest')).toHaveTextContent('exports a report');
  });

  it('asks for the chosen window, scoped to the project', async () => {
    const qa = makeQa();
    renderInsights(qa);
    await waitFor(() => expect(qa.getInsights).toHaveBeenCalledWith(14, TEST_PROJECT.id));
    fireEvent.click(await screen.findByRole('button', { name: '90 days' }));
    await waitFor(() => expect(qa.getInsights).toHaveBeenCalledWith(90, TEST_PROJECT.id));
    expect(qa.getHistory).toHaveBeenCalledWith(TEST_PROJECT.id, 90);
    expect(qa.getHistory).toHaveBeenCalledWith(TEST_PROJECT.id, 30);
  });

  it('ranks flaky tests and quarantines one from the leaderboard', async () => {
    const addQuarantine = vi.fn(async () => ({
      id: 'q1',
      testTitle: 'logs in',
      testFile: 'e2e/login.spec.ts',
      reason: null,
      quarantinedAt: '2026-09-26T00:00:00.000Z',
      status: 'pending' as const,
    }));
    renderInsights(makeQa(), makeApi({ addQuarantine }));
    const first = await screen.findByTestId('flaky-0');
    expect(first).toHaveTextContent('logs in');
    expect(first).toHaveTextContent('50% · 2 flips · 1 retried');
    fireEvent.click(within(first).getByRole('button', { name: 'Quarantine logs in' }));
    await waitFor(() =>
      expect(within(first).getByRole('button', { name: 'logs in is quarantined' })).toBeDisabled(),
    );
    expect(addQuarantine).toHaveBeenCalledWith({
      testTitle: 'logs in',
      testFile: 'e2e/login.spec.ts',
      stableId: 'e2e/login.spec.ts › logs in',
      reason: 'Flaky in Insights: 2 flips, 1 retries over 6 runs',
    });
  });

  it('says why a quarantine failed, and leaves the button armed', async () => {
    const addQuarantine = vi.fn(async () => {
      throw new Error('quarantine refused');
    });
    renderInsights(makeQa(), makeApi({ addQuarantine }));
    const first = await screen.findByTestId('flaky-0');
    fireEvent.click(within(first).getByRole('button', { name: 'Quarantine logs in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('quarantine refused'));
    expect(within(first).getByRole('button', { name: 'Quarantine logs in' })).toBeEnabled();
  });

  it('shows the slowest tests with their change, the heatmap, recovery and branches', async () => {
    renderInsights(makeQa());
    await waitFor(() => expect(screen.getAllByTestId('slow-test')).toHaveLength(2));
    const [slow, fresh] = screen.getAllByTestId('slow-test');
    expect(slow).toHaveTextContent('p50 4.2 s · p95 9.8 s');
    expect(slow).toHaveTextContent('+40%');
    expect(fresh).toHaveTextContent('new');
    expect(screen.getAllByTestId('heat-cell')).toHaveLength(14);
    expect(screen.getAllByTestId('branch-row').map((row) => row.textContent)).toEqual([
      'main88.9% · 9 runs',
      'feature/cart33.3% · 3 runs',
    ]);
    expect(screen.getByTestId('insights-recovery')).toHaveTextContent('red since');
    expect(screen.getByTestId('history-chart')).toBeInTheDocument();
  });

  it('charts failures day by day, so a reader sees whether instability is growing', async () => {
    const trend = makeTrend();
    renderInsights(
      makeQa({
        getTrend: vi.fn(async () => ({
          ...trend,
          buckets: trend.buckets.map((bucket, index) => ({ ...bucket, failed: index })),
        })),
      }),
    );
    expect(
      await screen.findByRole('table', { name: 'Failed results per day' }),
    ).toBeInTheDocument();
  });

  it('says what each empty panel is waiting for', async () => {
    renderInsights(
      makeQa({
        getInsights: vi.fn(async () =>
          makeInsights({
            runs: 0,
            flakyLeaderboard: [],
            slowestTests: [],
            failureHeatmap: [],
            passRateByBranch: [],
            mttr: {
              overall: { recoveries: 0, medianMs: null, p90Ms: null, openSince: null },
              suites: [],
            },
          }),
        ),
        getHistory: vi.fn(async () =>
          makeHistory({ points: [], collectingSince: '2026-09-25T10:00:00.000Z' }),
        ),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText('No test flipped between passing and failing in this window.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('No test reported a duration in this window.')).toBeInTheDocument();
    expect(screen.getAllByText('No runs in this window.')).toHaveLength(2);
    expect(screen.getByTestId('history-collecting')).toHaveTextContent('Collecting since');
    expect(screen.getByTestId('insight-mttr')).toHaveTextContent('0 recoveries');
    expect(screen.getByTestId('insight-slowest')).toHaveTextContent('no durations reported');
  });

  it('says there are no readings yet, and names a history failure', async () => {
    const { unmount } = renderInsights(
      makeQa({ getHistory: vi.fn(async () => makeHistory({ points: [], collectingSince: null })) }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('history-collecting')).toHaveTextContent('No readings yet'),
    );
    unmount();
    renderInsights(
      makeQa({
        getHistory: vi.fn(async () => {
          throw new Error('history unreadable');
        }),
        getReadiness: vi.fn(async () => {
          throw new Error('no readiness');
        }),
      }),
    );
    await waitFor(() => expect(screen.getByText('history unreadable')).toBeInTheDocument());
    expect(screen.getByTestId('insight-readiness')).toHaveTextContent('unread');
  });

  it('reports an insights failure, and a read in flight', async () => {
    const { unmount } = renderInsights(
      makeQa({
        getInsights: vi.fn(async () => {
          throw new Error('insights refused');
        }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('insights-error')).toHaveTextContent('insights refused'),
    );
    unmount();
    renderInsights(makeQa({ getInsights: vi.fn(() => new Promise<never>(() => undefined)) }));
    await waitFor(() => expect(screen.getByTestId('insights-loading')).toBeInTheDocument());
  });

  it('turns the panels into tabs on a narrow screen', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      renderInsights(makeQa({ getReadiness: vi.fn(async () => makeReadiness({ verdict: 'go' })) }));
      await screen.findByTestId('insights-flaky');
      expect(screen.queryByTestId('insights-heatmap')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Failures' }));
      expect(screen.getByTestId('insights-heatmap')).toBeInTheDocument();
      expect(screen.getByTestId('insight-readiness')).toHaveTextContent('Go');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the Tests area', () => {
  const insights = {
    runs: 82,
    flakyLeaderboard: [
      {
        key: 'k1',
        title: 'checkout › basket',
        file: 'e2e/checkout.spec.ts',
        runs: 82,
        flaky: 2,
        flips: 16,
        score: 0.2,
        lastSeen: '2026-11-09T00:00:00.000Z',
      },
    ],
    slowestTests: [
      {
        key: 's1',
        title: 'checkout › card',
        file: null,
        samples: 9,
        p50Ms: 2400,
        p95Ms: 3500,
        previousP50Ms: null,
        changePct: null,
      },
    ],
  } as never;

  it('turns each flaky test into one-click quarantine, with the evidence as the reason', async () => {
    const addQuarantine = vi.fn(async () => ({}) as never);
    const items = testItems(insights, { addQuarantine });
    expect(items.map((item) => item.title)).toEqual([
      'checkout › basket is flaky',
      'checkout › card is the slowest test',
    ]);
    const first = items[0]?.action;
    if (first === undefined || !('run' in first)) throw new Error('expected an automatic action');
    await first.run();
    expect(addQuarantine).toHaveBeenCalledWith({
      testTitle: 'checkout › basket',
      testFile: 'e2e/checkout.spec.ts',
      reason: 'Flaky: 16 flips in 82 runs (Lupin)',
    });
  });

  it('says the verdict in one sentence', () => {
    expect(testVerdict(insights, 2)).toBe('1 flaky test needs a decision.');
  });
});
