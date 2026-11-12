import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CockpitDriver } from '@lupin/shared-contracts';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { cockpitFixture, cockpitMetric } from '../test-utils.js';
import { ScoreImpactBanner } from './ScoreImpactBanner.js';

const run = (ref: string, candidate: boolean, change: number | null = -10): CockpitDriver => ({
  kind: 'run',
  ref,
  label: `Run ${ref}`,
  url: null,
  candidate,
  change,
  at: null,
});

const cockpit = cockpitFixture({
  overall: { ...cockpitFixture().overall, drivers: [run('run-1', false, -6)] },
  metrics: [
    cockpitMetric({ id: 'coverage', label: 'Coverage', drivers: [run('run-1', true, -10)] }),
    cockpitMetric({
      id: 'flaky-tests',
      label: 'Flaky tests',
      unit: 'count',
      drivers: [run('run-1', true, 3)],
    }),
    cockpitMetric({ id: 'tests', label: 'Tests', drivers: [run('run-2', true)] }),
  ],
});

const show = (
  runId: string,
  commit: string | null = 'abc1234def',
  getCockpit = vi.fn(async () => cockpit),
) =>
  render(<ScoreImpactBanner runId={runId} commit={commit} window="7d" getCockpit={getCockpit} />);

describe('ScoreImpactBanner: which project', () => {
  it("asks the cockpit about the run's own project, not whichever reported last", async () => {
    const getCockpit = vi.fn(async () => cockpit);
    render(
      <ScoreImpactBanner
        runId="run-1"
        commit={null}
        window="7d"
        projectId="p-9"
        getCockpit={getCockpit}
      />,
    );
    await screen.findByTestId('score-impact');
    expect(getCockpit).toHaveBeenCalledWith({ window: '7d', projectId: 'p-9' }, expect.anything());
  });
});

describe('ScoreImpactBanner', () => {
  it('names the run, what it is named for, and says possibly for a candidate', async () => {
    show('run-1');
    const banner = await screen.findByTestId('score-impact');
    expect(banner).toHaveTextContent('The dashboard names this run.');
    expect(banner).toHaveTextContent('The overall score changed on this run’s commit.');
    expect(banner).toHaveTextContent('Possibly behind Coverage (-10 pts)');
    expect(banner).toHaveTextContent('Possibly behind Flaky tests (+3)');
    expect(banner).not.toHaveTextContent('Tests (');
  });

  it('links each metric to its page for the same window, and back to the dashboard', async () => {
    show('run-1');
    expect(await screen.findByRole('link', { name: 'Coverage' })).toHaveAttribute(
      'href',
      '/dashboard/metric/coverage?window=7d&project=00000000-0000-4000-8000-000000000001',
    );
    expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute(
      'href',
      '/dashboard/now',
    );
  });

  it('links the run’s commit on GitHub, and says nothing of a commit it does not have', async () => {
    const { unmount } = show('run-1');
    const link = await screen.findByRole('link', { name: /Commit abc1234/u });
    expect(link).toHaveAttribute('href', 'https://github.com/octo/service/commit/abc1234def');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    unmount();
    show('run-1', null);
    await screen.findByTestId('score-impact');
    expect(screen.queryByText(/Commit /u)).toBeNull();
  });

  it('shows the commit as plain text when the project has no GitHub repository', async () => {
    show(
      'run-1',
      'abc1234def',
      vi.fn(async () => ({ ...cockpit, repository: null })),
    );
    const banner = await screen.findByTestId('score-impact');
    expect(banner).toHaveTextContent('Commit abc1234');
    expect(screen.queryByRole('link', { name: /Commit/u })).toBeNull();
  });

  it('shows nothing for a run the cockpit does not name', async () => {
    const getCockpit = vi.fn(async () => cockpit);
    show('run-9', 'abc1234', getCockpit);
    await waitFor(() => expect(getCockpit).toHaveBeenCalled());
    // Wait on the read itself, not the clock (ledger MNT-200): once it has answered and React
    // has rendered the answer, there is still no banner.
    await act(async () => {
      await getCockpit.mock.results[0]?.value;
    });
    expect(screen.queryByTestId('score-impact')).toBeNull();
  });

  it('shows nothing while it loads and nothing when the cockpit cannot be read', async () => {
    const pending = vi.fn(() => new Promise<never>(() => undefined));
    const { unmount } = show('run-1', 'abc', pending as never);
    expect(screen.queryByTestId('score-impact')).toBeNull();
    unmount();
    const failing = vi.fn(() => Promise.reject(new Error('offline')));
    show('run-1', 'abc', failing as never);
    await waitFor(() => expect(failing).toHaveBeenCalled());
    await act(async () => {
      await (failing.mock.results[0]?.value as Promise<never>).catch(() => undefined);
    });
    expect(screen.queryByTestId('score-impact')).toBeNull();
  });

  it('has no blocking accessibility violations', async () => {
    const { container } = show('run-1');
    await screen.findByTestId('score-impact');
    await expectNoBlockingAxeViolations(container);
  });
});
