import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { RunsListPage, runAreaItems, runVerdict } from './index.js';
import { makeApi, makeRun } from '../../test-utils.js';
import type { ApiClient } from '../../lib/api.js';

/**
 * Rendered inside a real router, because the page hosts `RecentRuns` and that renders
 * a TanStack `<Link>`. A `<Link>` outside a `RouterProvider` throws, so a bare
 * `render(<RunsListPage/>)` would be testing a component that cannot legally be
 * rendered on its own — a failure nobody can read. `MemoryRouter` from `router.ts`
 * is not usable here because it renders the route tree and **ignores children**.
 */
function renderRunsPage(api: ApiClient): void {
  const rootRoute = createRootRoute({ component: () => <RunsListPage api={api} /> });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard/runs'] }) });
  render(<RouterProvider router={router} />);
}

const passedRun = makeRun({
  id: 'run-abc12345',
  projectId: 'lupin',
  phase: 'complete',
  outcome: 'passed',
  createdAt: '2026-05-26T10:00:00.000Z',
  summary: {
    total: 20,
    passed: 20,
    failed: 0,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: 3_000,
  },
});

const failedRun = makeRun({
  id: 'run-def67890',
  projectId: 'dashboard',
  phase: 'complete',
  outcome: 'failed',
  createdAt: '2026-05-26T09:00:00.000Z',
  summary: {
    total: 15,
    passed: 10,
    failed: 5,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: 5_000,
  },
});

describe('runAreaItems', () => {
  const now = new Date('2026-05-26T12:00:00.000Z');
  const retryRun = vi.fn(async () => makeRun({ id: 'again' }));

  it('asks about a branch only while its newest run is red, and retries just what broke', async () => {
    const red = makeRun({
      id: 'red-new',
      branch: 'feat/pay',
      outcome: 'failed',
      createdAt: '2026-05-26T11:00:00.000Z',
      summary: { ...failedRun.summary, failed: 2 },
      tests: [
        { id: 't1', title: 'pays', status: 'failed' },
        { id: 't2', title: 'ships', status: 'passed' },
      ] as never,
    });
    const olderRed = makeRun({
      id: 'red-old',
      branch: 'feat/pay',
      outcome: 'failed',
      createdAt: '2026-05-26T10:00:00.000Z',
    });
    const fixed = makeRun({
      id: 'fixed',
      branch: 'main',
      outcome: 'passed',
      createdAt: '2026-05-26T11:30:00.000Z',
    });
    const brokeBefore = makeRun({
      id: 'broke-before',
      branch: 'main',
      outcome: 'failed',
      createdAt: '2026-05-26T09:00:00.000Z',
    });
    const items = runAreaItems([olderRed, fixed, brokeBefore, red], { retryRun }, now);
    expect(items.map((item) => item.id)).toEqual(['run-red-new']);
    expect(items[0]?.title).toBe('2 tests failing on feat/pay');
    expect(items[0]?.detail).toBe('Latest run on this branch');
    expect(items[0]?.action.label).toBe('Retry the failed test');
    if (!('run' in items[0]!.action)) throw new Error('expected an action Lupin takes');
    await items[0]!.action.run();
    expect(retryRun).toHaveBeenCalledWith('red-new', undefined, { scope: 'failed' });
  });

  it('names a run that has been going for over an hour as worth a look', () => {
    const stuck = makeRun({
      id: 'stuck',
      branch: 'main',
      phase: 'running',
      outcome: null,
      startedAt: '2026-05-26T10:00:00.000Z',
    });
    const items = runAreaItems([stuck], { retryRun }, now);
    expect(items[0]).toMatchObject({ tone: 'warn', action: { to: '/dashboard/runs/stuck' } });
  });

  it('retries the whole run when it listed no tests, and words a branchless stuck run by its suite', async () => {
    const red = makeRun({ id: 'red-bare', branch: 'main', outcome: 'blocked', tests: [] });
    const stuck = makeRun({
      id: 'stuck-suite',
      branch: null,
      suite: 'nightly',
      phase: 'running',
      outcome: null,
      startedAt: '2026-05-26T10:00:00.000Z',
    });
    const items = runAreaItems([red, stuck], { retryRun }, now);
    expect(items.map((item) => item.title)).toEqual([
      'main is failing',
      'nightly has been running over an hour',
    ]);
    expect(items[0]?.action.label).toBe('Retry now');
    if (!('run' in items[0]!.action)) throw new Error('expected an action Lupin takes');
    await items[0]!.action.run();
    expect(retryRun).toHaveBeenCalledWith('red-bare', undefined, { scope: 'all' });
  });

  it('judges a branch by its newest finished run, so a queued or cancelled retry hides nothing', () => {
    const red = makeRun({
      id: 'red',
      branch: 'main',
      phase: 'complete',
      outcome: 'failed',
      createdAt: '2026-05-26T09:00:00.000Z',
    });
    const queued = makeRun({
      id: 'queued',
      branch: 'main',
      phase: 'queued',
      outcome: null,
      createdAt: '2026-05-26T11:00:00.000Z',
    });
    const cancelled = makeRun({
      id: 'cancelled',
      branch: 'main',
      phase: 'cancelled',
      outcome: 'cancelled',
      createdAt: '2026-05-26T10:00:00.000Z',
    });
    const items = runAreaItems([queued, cancelled, red], { retryRun }, now);
    expect(items.map((item) => item.id)).toEqual(['run-red']);
  });

  it('says how many branches are red, or that every branch is green', () => {
    expect(runVerdict(0)).toBe('Every branch is green.');
    expect(runVerdict(1)).toBe('One branch needs you.');
    expect(runVerdict(3)).toBe('3 branches need you.');
  });
});

describe('RunsListPage', () => {
  it('leads with what needs doing, and keeps every run under Details', async () => {
    renderRunsPage(makeApi({ getRuns: vi.fn().mockResolvedValue([failedRun]) }));
    await waitFor(() => expect(screen.getByTestId('area-runs')).toBeInTheDocument());
    const hero = screen.getByRole('region', { name: 'Failing' });
    expect(hero).toHaveTextContent('One branch needs you.');
    expect(screen.getByTestId(`area-item-run-${failedRun.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('area-details')).toContainElement(
      screen.getByTestId(`run-row-${failedRun.id}`),
    );
  });

  it('badges a partial, an unknown and a cancelled outcome without calling any of them a pass', async () => {
    const runs = (['partial', 'unknown', 'cancelled'] as const).map((outcome, index) =>
      makeRun({
        id: `run-${outcome}`,
        branch: `b-${String(index)}`,
        phase: 'complete',
        outcome,
      }),
    );
    renderRunsPage(makeApi({ getRuns: vi.fn().mockResolvedValue(runs) }));
    await waitFor(() => expect(screen.getByTestId('run-outcome-run-partial')).toBeInTheDocument());
    expect(screen.getByTestId('run-outcome-run-partial')).toHaveTextContent('partial');
    expect(screen.getByTestId('run-outcome-run-unknown')).toHaveTextContent('unknown');
    expect(screen.getByTestId('run-outcome-run-cancelled')).toHaveTextContent('cancelled');
  });

  it('renders loading state initially', async () => {
    const api = makeApi({
      getRuns: vi.fn(() => new Promise<ReturnType<typeof makeRun>[]>(() => undefined)),
    });
    renderRunsPage(api);
    // Awaited, not synchronous: `RouterProvider` renders the route on a tick after
    // mount, so the first paint is the router's own loading state rather than the
    // page's. Asserting immediately would pass or fail on scheduler timing.
    await waitFor(() => expect(screen.getByTestId('runs-list-loading')).toBeInTheDocument());
  });

  it('describes the page in its subtitle, and shows the live state as a dot and a word beside the action', async () => {
    renderRunsPage(makeApi({ getRuns: vi.fn().mockResolvedValue([passedRun]) }));
    await waitFor(() => expect(screen.getByTestId('runs-list-page')).toBeInTheDocument());
    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('Every run Lupin has received, newest first.');
    expect(header).not.toHaveTextContent('Live stream');
    const live = screen.getByTestId('runs-live-state');
    expect(live).toHaveTextContent(/^(Live|Reconnecting)$/u);
    expect(live.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders error state when fetch fails', async () => {
    const api = makeApi({ getRuns: vi.fn().mockRejectedValue(new Error('Network error')) });
    renderRunsPage(api);
    await waitFor(() => expect(screen.getByTestId('runs-list-error')).toBeInTheDocument());
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('loads the runs again when the retry button is pressed', async () => {
    const getRuns = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue([passedRun]);
    renderRunsPage(makeApi({ getRuns }));
    const retry = await screen.findByRole('button', { name: 'Try loading runs again' });
    // The page also polls and refetches on events, so the click is measured on its own:
    // it must start a request then and there, not leave the next poll to do it.
    const before = getRuns.mock.calls.length;
    fireEvent.click(retry);
    expect(getRuns).toHaveBeenCalledTimes(before + 1);
    await waitFor(() => expect(screen.queryByTestId('runs-list-error')).not.toBeInTheDocument());
  });

  it('renders empty state without claiming a passing release', async () => {
    renderRunsPage(makeApi());
    await waitFor(() => expect(screen.getByTestId('runs-list-empty')).toBeInTheDocument());
    expect(screen.getByTestId('runs-list-empty')).toHaveTextContent('No execution evidence');
  });

  it('renders canonical run phase and outcome with statistics', async () => {
    renderRunsPage(makeApi({ getRuns: vi.fn().mockResolvedValue([passedRun, failedRun]) }));
    await waitFor(() => expect(screen.getByTestId('runs-list-page')).toBeInTheDocument());
    expect(screen.getByTestId('run-row-run-abc12345')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-def67890')).toBeInTheDocument();
    expect(screen.getByTestId('run-outcome-run-abc12345')).toHaveTextContent('passed');
    expect(screen.getByTestId('run-outcome-run-def67890')).toHaveTextContent('failed');
    expect(screen.getByTestId('stat-total')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-passed')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-failed')).toHaveTextContent('1');
  });

  it('renders active phases and canonical detail links', async () => {
    const activeRun = makeRun({ id: 'run-active', projectId: 'project', phase: 'running' });
    renderRunsPage(makeApi({ getRuns: vi.fn().mockResolvedValue([activeRun]) }));
    await waitFor(() => expect(screen.getByTestId('stat-running')).toHaveTextContent('1'));
    const link = screen.getByRole('link', { name: 'run-acti' });
    expect(link).toHaveAttribute('href', '/dashboard/runs/run-active');
  });

  it('drops the project and duration columns when no run reports them', async () => {
    const unknownRun = makeRun({
      id: 'run-unknown',
      projectId: null,
      phase: 'queued',
      summary: { ...passedRun.summary, total: 0, passed: 0, durationMs: null },
    });
    renderRunsPage(makeApi({ getRuns: vi.fn().mockResolvedValue([unknownRun]) }));
    await waitFor(() => expect(screen.getByTestId('run-row-run-unknown')).toBeInTheDocument());
    const row = screen.getByTestId('run-row-run-unknown');
    expect(row).not.toHaveTextContent('UNKNOWN');
    expect(row).toHaveTextContent('No tests reported');
    expect(screen.queryByRole('columnheader', { name: 'Project' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Duration' })).toBeNull();
  });

  it('keeps a column some runs report, and dashes the runs that do not', async () => {
    const unknownRun = makeRun({
      id: 'run-unknown',
      projectId: null,
      phase: 'complete',
      outcome: 'passed',
      summary: { ...passedRun.summary, durationMs: null },
    });
    renderRunsPage(makeApi({ getRuns: vi.fn().mockResolvedValue([passedRun, unknownRun]) }));
    await waitFor(() => expect(screen.getByTestId('run-row-run-unknown')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Duration' })).toBeInTheDocument();
    const row = screen.getByTestId('run-row-run-unknown');
    expect(row).not.toHaveTextContent('UNKNOWN');
    expect(row).toHaveTextContent('—');
  });
});
