import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Cockpit } from '@lupin/shared-contracts';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { cockpitFixture, cockpitMetric } from '../test-utils.js';
import { QaApiError } from '../lib/qa-client.js';
import { MetricDetailPage, type MetricSources } from './MetricDetail.js';

const sources = (cockpit?: MetricSources['cockpit']): MetricSources => ({
  cockpit: cockpit ?? vi.fn(async () => cockpitFixture()),
});

const show = (metricId: string, cockpit?: MetricSources['cockpit'], window?: 'release') =>
  render(
    <MetricDetailPage
      metricId={metricId}
      sources={sources(cockpit)}
      {...(window === undefined ? {} : { initialWindow: window })}
    />,
  );

describe('MetricDetailPage', () => {
  it('names the metric, says where it came from, and how far it moved', async () => {
    show('coverage');
    expect(screen.getByRole('heading', { level: 1, name: 'Coverage' })).toBeTruthy();
    const summary = await screen.findByTestId('metric-summary');
    expect(summary).toHaveTextContent('60%');
    expect(summary).toHaveTextContent('-10 pts');
    expect(summary).toHaveTextContent('(worse)');
    expect(summary).toHaveTextContent('from 70% at the start of the window');
    expect(screen.getByTestId('metric-scope')).toHaveTextContent('Service · main');
    expect(screen.getByRole('link', { name: 'Back to the cockpit' })).toHaveAttribute(
      'href',
      '/dashboard/now',
    );
  });

  it('draws the readings and lists them in a table, newest first', async () => {
    show('coverage');
    const series = await screen.findByTestId('metric-series');
    expect(within(series).getByRole('img')).toBeTruthy();
    const rows = within(series).getAllByRole('row');
    // A header and the two readings.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('2026-10-25 12:00');
    expect(rows[1]).toHaveTextContent('60%');
    expect(rows[2]).toHaveTextContent('70%');
  });

  it('says there are no readings, instead of drawing an empty chart', async () => {
    show('code-quality');
    expect(await screen.findByTestId('metric-no-readings')).toBeTruthy();
    expect(screen.queryByTestId('metric-series')).toBeNull();
  });

  it('says why there is no change instead of showing one', async () => {
    show('dependencies');
    const summary = await screen.findByTestId('metric-summary');
    expect(summary).toHaveTextContent('No earlier reading to compare with');
    expect(summary).not.toHaveTextContent('pts');
    expect(await screen.findByTestId('metric-no-drivers')).toHaveTextContent(
      'It did not move, so there is nothing to explain.',
    );
  });

  it('opens a run inside the product, and a pull request on GitHub, and calls a candidate possible', async () => {
    show(
      'coverage',
      vi.fn(async () =>
        cockpitFixture({
          metrics: [
            cockpitMetric({
              drivers: [
                {
                  kind: 'run',
                  ref: 'run-2',
                  label: 'Run on abc1234',
                  url: null,
                  candidate: true,
                  change: -10,
                  at: '2026-10-24T12:00:00.000Z',
                },
                {
                  kind: 'pull_request',
                  ref: '7',
                  label: 'PR #7: Fix it',
                  url: 'https://github.com/octo/service/pull/7',
                  candidate: false,
                  change: -2,
                  at: null,
                },
                {
                  kind: 'unknown',
                  ref: null,
                  label: 'No run was recorded while this changed',
                  url: null,
                  candidate: false,
                  change: -1,
                  at: null,
                },
              ],
            }),
          ],
        }),
      ),
    );
    const drivers = await screen.findByRole('list', { name: 'Drivers' });
    const run = within(drivers).getByRole('link', { name: 'Possibly: Run on abc1234' });
    expect(run).toHaveAttribute('href', '/dashboard/runs/run-2?from=cockpit&window=7d');
    const pullRequest = within(drivers).getByRole('link', { name: /PR #7: Fix it/u });
    expect(pullRequest).toHaveAttribute('href', 'https://github.com/octo/service/pull/7');
    expect(pullRequest).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(drivers).getByText('No run was recorded while this changed')).toBeTruthy();
    expect(within(drivers).getByText('Cause unknown')).toBeTruthy();
    expect(screen.getByTestId('metric-candidate-note')).toHaveTextContent('none of them is named');
  });

  it('says nothing recorded explains a metric that moved with no driver', async () => {
    show('tests');
    expect(await screen.findByTestId('metric-no-drivers')).toHaveTextContent(
      'Nothing recorded says what moved this.',
    );
  });

  it('sends each metric to the pages that go deeper, as links', async () => {
    show('flaky-tests');
    const links = await screen.findByRole('list', { name: 'Pages that go deeper' });
    const hrefs = within(links)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/dashboard/flaky/00000000-0000-4000-8000-000000000001',
      '/dashboard/quarantine',
    ]);
  });

  it('asks again for the window a person chooses', async () => {
    const user = userEvent.setup();
    const cockpit = vi.fn(async (query: { window: string }) =>
      cockpitFixture({ window: query.window as Cockpit['window'] }),
    );
    show('coverage', cockpit as never);
    await screen.findByTestId('metric-summary');
    expect(cockpit).toHaveBeenLastCalledWith({ window: '7d' }, expect.any(AbortSignal));
    await user.click(screen.getByRole('button', { name: 'Since last release' }));
    await waitFor(() =>
      expect(cockpit).toHaveBeenLastCalledWith({ window: 'release' }, expect.any(AbortSignal)),
    );
    expect(screen.getByRole('button', { name: 'Since last release' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('opens on the window the link named', async () => {
    const cockpit = vi.fn(async () => cockpitFixture({ window: 'release' }));
    show('coverage', cockpit, 'release');
    await screen.findByTestId('metric-summary');
    expect(cockpit).toHaveBeenCalledWith({ window: 'release' }, expect.any(AbortSignal));
  });

  it('shows a loading state, and the server’s own sentence on a failure', async () => {
    show(
      'coverage',
      vi.fn(() => new Promise<Cockpit>(() => undefined)),
    );
    expect(screen.getByTestId('metric-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('says what went wrong when the cockpit cannot be read', async () => {
    show(
      'coverage',
      vi.fn(() => Promise.reject(new QaApiError(404, 'No project to show'))),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This metric could not be read.');
    expect(alert).toHaveTextContent('No project to show');
  });

  it('says so when the cockpit does not report the metric', async () => {
    show(
      'coverage',
      vi.fn(async () =>
        cockpitFixture({ metrics: [cockpitMetric({ id: 'tests', label: 'Tests' })] }),
      ),
    );
    expect(await screen.findByTestId('metric-missing')).toHaveTextContent('did not report');
  });

  it('refuses a metric the cockpit does not have, without asking the server', () => {
    const cockpit = vi.fn(async () => cockpitFixture());
    show('<script>alert(1)</script>', cockpit);
    expect(screen.getByTestId('metric-unknown')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Unknown metric' })).toBeTruthy();
    expect(cockpit).not.toHaveBeenCalled();
    // What was typed is text on the page, never markup.
    expect(document.querySelector('script')).toBeNull();
  });

  it('has no blocking accessibility violations once it has settled', async () => {
    const { container } = show('coverage');
    await screen.findByTestId('metric-series');
    await expectNoBlockingAxeViolations(container);
  });
});
