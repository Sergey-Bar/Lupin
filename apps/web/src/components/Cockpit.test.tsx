import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cockpit } from '@lupin/shared-contracts';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { cockpitFixture, cockpitMetric } from '../test-utils.js';
import { QaApiError } from '../lib/qa-client.js';
import { greetingFor } from '../lib/focus.js';
import { CockpitPage, safeHref, type CockpitSources } from './Cockpit.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');

function sources(
  cockpit: CockpitSources['cockpit'] = vi.fn(async () => cockpitFixture()),
  projects: CockpitSources['projects'] = async () => [],
): CockpitSources {
  return {
    cockpit,
    projects,
    attention: {
      runs: vi.fn(async () => []),
      portfolio: vi.fn(async () => ({ projects: [] })),
      deliveries: vi.fn(async () => []),
    },
  };
}

const show = (
  cockpit?: CockpitSources['cockpit'],
  navigate: (to: string) => void = () => undefined,
) => render(<CockpitPage sources={sources(cockpit)} navigate={navigate} now={() => NOW} />);

afterEach(() => {
  localStorage.clear();
});

describe('the headline', () => {
  it('opens on the one answer: the score, and the sentence that says why', async () => {
    show();
    const status = await screen.findByTestId('cockpit-status');
    expect(status).toHaveTextContent('74');
    expect(status).toHaveTextContent(
      'Down 6 points since last week, mostly lower coverage and more flaky tests.',
    );
    expect(screen.getByTestId('cockpit-scope')).toHaveTextContent('Service · main');
  });

  it('links the change to the pull request that caused it, and opens it safely', async () => {
    show();
    const link = await screen.findByRole('link', { name: 'See the change' });
    expect(link).toHaveAttribute('href', 'https://github.com/octo/service/pull/42');
  });

  it('has no link to follow when the cause is not known', async () => {
    show(
      vi.fn(async () =>
        cockpitFixture({
          overall: {
            ...cockpitFixture().overall,
            drivers: [
              {
                kind: 'unknown',
                ref: null,
                label: 'No commit was recorded for this change',
                url: null,
                candidate: false,
                change: -6,
                at: null,
              },
            ],
          },
        }),
      ),
    );
    await screen.findByTestId('cockpit-status');
    expect(screen.queryByRole('link', { name: 'See the change' })).toBeNull();
  });

  it('shows a dash, not a 0, when nothing was measured', async () => {
    show(
      vi.fn(async () =>
        cockpitFixture({
          headline: 'Nothing was measured in the last 7 days.',
          overall: {
            score: null,
            letter: null,
            baseline: null,
            delta: null,
            status: 'not_measured',
            drivers: [],
          },
        }),
      ),
    );
    const status = await screen.findByTestId('cockpit-status');
    expect(status).toHaveTextContent('\u2014');
    expect(status).toHaveTextContent('Nothing was measured in the last 7 days.');
    expect(status).not.toHaveTextContent(/\b0\b/u);
  });
});

describe('the metrics', () => {
  it('shows all seven, each with its value', async () => {
    show();
    const list = await screen.findByRole('list', { name: 'Metrics' });
    expect(within(list).getAllByRole('heading', { level: 3 })).toHaveLength(7);
    expect(screen.getByTestId('cockpit-metric-coverage')).toHaveTextContent('60%');
    expect(screen.getByTestId('cockpit-metric-flaky-tests')).toHaveTextContent('5');
    expect(screen.getByTestId('cockpit-metric-run-pass-rate')).toHaveTextContent('25%');
  });

  it('draws a change only for a real comparison, and says the verdict in words', async () => {
    show();
    await screen.findByRole('list', { name: 'Metrics' });
    const coverage = screen.getByTestId('cockpit-metric-coverage');
    expect(coverage).toHaveTextContent('-10 pts');
    expect(coverage).toHaveTextContent('(worse)');
    // More flaky tests is a rise, and a worse one.
    const flaky = screen.getByTestId('cockpit-metric-flaky-tests');
    expect(flaky).toHaveTextContent('+3');
    expect(flaky).toHaveTextContent('(worse)');
  });

  it('says why a metric has no change instead of showing one', async () => {
    show();
    await screen.findByRole('list', { name: 'Metrics' });
    const unmeasured = screen.getByTestId('cockpit-metric-code-quality');
    expect(unmeasured).toHaveTextContent('Not measured in this window');
    expect(unmeasured).not.toHaveTextContent('pts');
    expect(screen.getByTestId('cockpit-metric-dependencies')).toHaveTextContent(
      'No earlier reading to compare with',
    );
    expect(screen.getByTestId('cockpit-metric-security')).toHaveTextContent('No meaningful change');
  });

  it('says the formula changed instead of comparing across it', async () => {
    show(
      vi.fn(async () =>
        cockpitFixture({
          metrics: [
            cockpitMetric({
              id: 'security',
              label: 'Security',
              unit: 'score',
              value: 60,
              baseline: 90,
              delta: null,
              status: 'formula_changed',
            }),
          ],
        }),
      ),
    );
    const card = await screen.findByTestId('cockpit-metric-security');
    expect(card).toHaveTextContent('Scoring formula changed, so no comparison');
    expect(card).not.toHaveTextContent('pts');
  });

  it('offers a candidate as only possible, and a known cause as it is', async () => {
    show(
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
                  at: null,
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
              ],
            }),
          ],
        }),
      ),
    );
    const card = await screen.findByTestId('cockpit-metric-coverage');
    expect(card).toHaveTextContent('Possibly: Run on abc1234');
    const link = within(card).getByRole('link', { name: /PR #7: Fix it/u });
    expect(link).toHaveAttribute('href', 'https://github.com/octo/service/pull/7');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('does not follow a link that is not https', async () => {
    show(
      vi.fn(async () =>
        cockpitFixture({
          metrics: [
            cockpitMetric({
              drivers: [
                {
                  kind: 'commit',
                  ref: 'abc',
                  label: 'Commit abc',
                  url: 'http://insecure.example/commit/abc',
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
    const card = await screen.findByTestId('cockpit-metric-coverage');
    expect(within(card).queryByRole('link', { name: /Commit abc/u })).toBeNull();
    expect(card).toHaveTextContent('Commit abc');
  });

  it('draws a sparkline for a series and none for a metric with no readings', async () => {
    show();
    await screen.findByRole('list', { name: 'Metrics' });
    expect(
      within(screen.getByTestId('cockpit-metric-coverage')).getByRole('img', {
        name: /Coverage over time, 60%/u,
      }),
    ).toBeTruthy();
    expect(within(screen.getByTestId('cockpit-metric-code-quality')).queryByRole('img')).toBeNull();
  });
});

describe('the window', () => {
  it('asks again for the window a person chooses, and shows which is chosen', async () => {
    const user = userEvent.setup();
    const cockpit = vi.fn(async (query: { window: string }) =>
      cockpitFixture({
        window: query.window as Cockpit['window'],
        headline:
          query.window === 'release'
            ? 'Down 7 points since the last release.'
            : 'Down 6 points since last week.',
      }),
    );
    show(cockpit as never);
    expect(await screen.findByTestId('cockpit-status')).toHaveTextContent('since last week');
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Since last release' }));
    await waitFor(() =>
      expect(screen.getByTestId('cockpit-status')).toHaveTextContent('since the last release'),
    );
    expect(cockpit).toHaveBeenLastCalledWith({ window: 'release' }, expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Since last release' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('never shows the previous window\u2019s headline while the new one loads', async () => {
    const user = userEvent.setup();
    let release: (value: Cockpit) => void = () => undefined;
    const cockpit = vi.fn((query: { window: string }) =>
      query.window === '7d'
        ? Promise.resolve(cockpitFixture({ headline: 'The seven-day headline.' }))
        : new Promise<Cockpit>((done) => (release = done)),
    );
    show(cockpit as never);
    await screen.findByText('The seven-day headline.');
    await user.click(screen.getByRole('button', { name: 'Since last release' }));
    expect(screen.queryByText('The seven-day headline.')).toBeNull();
    expect(screen.getByTestId('cockpit-loading')).toBeTruthy();
    release(cockpitFixture({ headline: 'The release headline.' }));
    await screen.findByText('The release headline.');
  });
});

describe('loading and failing', () => {
  it('shows a loading state that keeps the page\u2019s shape', async () => {
    show(vi.fn(() => new Promise<Cockpit>(() => undefined)));
    expect(screen.getByTestId('cockpit-loading')).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /^Good (morning|afternoon|evening)|^Working late/u,
      }),
    ).toBeTruthy();
    // The section under it settles on its own, so wait for it rather than leave it mid-update.
    await screen.findByTestId('now-clear');
  });

  it('turns a bare "not found" into what is missing and one next step', async () => {
    const cockpit = vi
      .fn<CockpitSources['cockpit']>()
      .mockRejectedValue(new QaApiError(404, 'not found'));
    show(cockpit);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No project has sent results yet');
    expect(alert).not.toHaveTextContent(/\bnot found\b/u);
    expect(within(alert).getByRole('link', { name: 'Set up Lupin' })).toHaveAttribute(
      'href',
      '/dashboard/setup',
    );
  });

  it('says the server\u2019s own sentence on a failure, and reads again on request', async () => {
    const user = userEvent.setup();
    const cockpit = vi
      .fn<CockpitSources['cockpit']>()
      .mockRejectedValueOnce(new QaApiError(404, 'This workspace has no project to show'))
      .mockResolvedValue(cockpitFixture());
    show(cockpit);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The cockpit could not be read.');
    expect(alert).toHaveTextContent('This workspace has no project to show');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('cockpit-status')).toHaveTextContent('74');
    expect(cockpit).toHaveBeenCalledTimes(2);
  });

  it('keeps showing what needs you when the cockpit itself cannot be read', async () => {
    const failing = sources(vi.fn(() => Promise.reject(new Error('offline'))));
    failing.attention.runs = vi.fn(async () => []);
    render(<CockpitPage sources={failing} navigate={vi.fn()} now={() => NOW} />);
    await screen.findByRole('alert');
    expect(await screen.findByTestId('now-clear')).toBeTruthy();
  });
});

describe('the home page, as one focus', () => {
  it('greets the reader, then puts the focus above the numbers', async () => {
    show();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(greetingFor(NOW));
    const focus = await screen.findByTestId('now-page');
    const numbers = screen.getByTestId('cockpit-everything');
    expect(focus.compareDocumentPosition(numbers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('folds the product numbers away under one quiet line', async () => {
    show();
    const numbers = await screen.findByTestId('cockpit-everything');
    expect(numbers.tagName).toBe('DETAILS');
    expect(numbers).not.toHaveAttribute('open');
    expect(numbers.querySelector('summary')).toHaveTextContent('How the product is doing');
  });

  it('lets focus mode put the numbers away', async () => {
    show();
    const numbers = await screen.findByTestId('cockpit-everything');
    expect(numbers).toHaveAttribute('data-chrome', 'secondary');
  });
});
describe('pace against quality', () => {
  it('loads after the headline and carries every number in a table', async () => {
    show();
    await screen.findByTestId('cockpit-status');
    const chart = await screen.findByTestId('cockpit-pace');
    expect(within(chart).getByRole('img')).toBeTruthy();
    const table = within(chart).getByRole('table', { name: /Pull requests merged and score/u });
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    // The fixture has no reading for its first three weeks.
    expect(within(table).getAllByText('not measured', { selector: 'td' })).toHaveLength(3);
  });

  it('says where the formula changed on the chart', async () => {
    const base = cockpitFixture();
    show(
      vi.fn(async () =>
        cockpitFixture({
          pace: base.pace.map((week, index) =>
            index === 6 || index === 7 ? { ...week, score: 60, formulaVersion: 2 } : week,
          ),
        }),
      ),
    );
    const chart = await screen.findByTestId('cockpit-pace');
    expect(chart).toHaveTextContent('the scoring formula changed here');
  });
});

describe('what needs you', () => {
  it('sits under the cockpit, so the answer and the work are on one screen', async () => {
    show();
    await screen.findByTestId('cockpit-status');
    expect(await screen.findByTestId('now-clear')).toHaveTextContent('All clear');
  });
});

describe('accessibility', () => {
  it('has no blocking violations once the page has settled', async () => {
    const { container } = show();
    await screen.findByTestId('cockpit-pace');
    await screen.findByTestId('now-clear');
    await expectNoBlockingAxeViolations(container);
  });
});

describe('safeHref', () => {
  it('follows https and nothing else', () => {
    expect(safeHref('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1');
    expect(safeHref('http://github.com/o/r')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

describe('the way down', () => {
  it('opens a metric from its card, for the window being shown', async () => {
    const user = userEvent.setup();
    show();
    const card = await screen.findByTestId('cockpit-metric-coverage');
    expect(within(card).getByRole('link', { name: /Coverage, open details/u })).toHaveAttribute(
      'href',
      '/dashboard/metric/coverage?window=7d&project=00000000-0000-4000-8000-000000000001',
    );
    await user.click(screen.getByRole('button', { name: 'Since last release' }));
    const again = await screen.findByTestId('cockpit-metric-coverage');
    await waitFor(() =>
      expect(within(again).getByRole('link', { name: /Coverage, open details/u })).toHaveAttribute(
        'href',
        '/dashboard/metric/coverage?window=release&project=00000000-0000-4000-8000-000000000001',
      ),
    );
  });

  it('opens a run inside the product, saying it came from the cockpit', async () => {
    show();
    const card = await screen.findByTestId('cockpit-metric-coverage');
    expect(within(card).getByRole('link', { name: 'Possibly: Run on abc1234' })).toHaveAttribute(
      'href',
      '/dashboard/runs/run-2?from=cockpit&window=7d',
    );
  });
});

describe('the report', () => {
  it('offers the cockpit as a file to save, for the window being shown', async () => {
    const user = userEvent.setup();
    show();
    const link = await screen.findByTestId('cockpit-report');
    expect(link).toHaveAttribute(
      'href',
      '/api/v1/projects/00000000-0000-4000-8000-000000000001/cockpit/report.html?window=7d&download=1',
    );
    expect(link).toHaveTextContent('Download report');
    await user.click(screen.getByRole('button', { name: 'Since last release' }));
    await waitFor(() =>
      expect(screen.getByTestId('cockpit-report')).toHaveAttribute(
        'href',
        expect.stringContaining('window=release'),
      ),
    );
  });

  it('is not offered while the cockpit is loading or when it could not be read', async () => {
    const { unmount } = show(vi.fn(() => new Promise<Cockpit>(() => undefined)));
    expect(screen.queryByTestId('cockpit-report')).toBeNull();
    await screen.findByTestId('now-clear');
    unmount();
    show(vi.fn(() => Promise.reject(new Error('offline'))));
    await screen.findByRole('alert');
    expect(screen.queryByTestId('cockpit-report')).toBeNull();
    await screen.findByTestId('now-clear');
  });
});

describe('the pull requests worth a look', () => {
  const item = {
    kind: 'merged_without_human_approval' as const,
    number: 12,
    title: 'Rework the cache',
    url: 'https://github.com/octo/service/pull/12',
    detail: 'Merged with no approval from a person.',
    at: '2026-10-24T10:00:00.000Z',
  };

  it('lists each pull request with a link and the one fact that put it there', async () => {
    show(vi.fn(async () => cockpitFixture({ risks: { total: 1, items: [item] } })));
    const section = await screen.findByTestId('cockpit-risks');
    expect(section).toHaveTextContent('#12 Rework the cache');
    expect(section).toHaveTextContent('Merged with no approval from a person.');
    expect(screen.getByRole('link', { name: /#12 Rework the cache/u })).toHaveAttribute(
      'href',
      'https://github.com/octo/service/pull/12',
    );
  });

  it('says how many more there are, and renders an unsafe address as plain text', async () => {
    show(
      vi.fn(async () =>
        cockpitFixture({
          risks: { total: 14, items: [{ ...item, url: 'javascript:alert(1)' }] },
        }),
      ),
    );
    const section = await screen.findByTestId('cockpit-risks');
    expect(section).toHaveTextContent('Showing the newest 1 of 14.');
    expect(screen.queryByRole('link', { name: /#12/u })).toBeNull();
  });

  it('says nothing matched and what it reads, rather than showing a bare empty list', async () => {
    show();
    const section = await screen.findByTestId('cockpit-risks');
    expect(section).toHaveTextContent('No pull request matched.');
    expect(section).toHaveTextContent('if none are synced, nothing was checked');
  });
});

describe('choosing the project', () => {
  const PROJECTS = [
    { id: 'p-1', name: 'Service' },
    { id: 'p-2', name: 'Website' },
  ];

  it('offers the projects, with the latest report as the default', async () => {
    render(
      <CockpitPage
        sources={sources(undefined, async () => PROJECTS)}
        navigate={() => undefined}
        now={() => NOW}
      />,
    );
    const select = await screen.findByLabelText('Project');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Latest report', 'Service', 'Website']);
    expect(select).toHaveValue('');
  });

  it('reads the chosen project, tells the address, and links its metrics to the same project', async () => {
    const user = userEvent.setup();
    const getCockpit = vi.fn(async () =>
      cockpitFixture({ projectId: 'p-2', projectName: 'Website' }),
    );
    const onProjectChange = vi.fn();
    render(
      <CockpitPage
        sources={sources(getCockpit, async () => PROJECTS)}
        navigate={() => undefined}
        now={() => NOW}
        onProjectChange={onProjectChange}
      />,
    );
    await user.selectOptions(await screen.findByLabelText('Project'), 'p-2');
    expect(onProjectChange).toHaveBeenCalledWith('p-2');
    await waitFor(() =>
      expect(getCockpit).toHaveBeenLastCalledWith(
        { window: '7d', projectId: 'p-2' },
        expect.anything(),
      ),
    );
    const card = await screen.findByTestId('cockpit-metric-coverage');
    expect(within(card).getByRole('link', { name: /Coverage/u })).toHaveAttribute(
      'href',
      '/dashboard/metric/coverage?window=7d&project=p-2',
    );
  });

  it('opens on the project the address names, and goes back to the default on request', async () => {
    const user = userEvent.setup();
    const getCockpit = vi.fn(async () => cockpitFixture());
    const onProjectChange = vi.fn();
    render(
      <CockpitPage
        sources={sources(getCockpit, async () => PROJECTS)}
        navigate={() => undefined}
        now={() => NOW}
        initialProjectId="p-1"
        onProjectChange={onProjectChange}
      />,
    );
    const select = await screen.findByLabelText('Project');
    expect(select).toHaveValue('p-1');
    expect(getCockpit).toHaveBeenCalledWith({ window: '7d', projectId: 'p-1' }, expect.anything());
    await user.selectOptions(select, '');
    expect(onProjectChange).toHaveBeenLastCalledWith(undefined);
  });

  it('shows no picker for one project, or when the list cannot be read', async () => {
    const { unmount } = render(
      <CockpitPage
        sources={sources(undefined, async () => [PROJECTS[0] as (typeof PROJECTS)[number]])}
        navigate={() => undefined}
        now={() => NOW}
      />,
    );
    await screen.findByTestId('cockpit-status');
    expect(screen.queryByLabelText('Project')).toBeNull();
    unmount();
    render(
      <CockpitPage
        sources={sources(undefined, () => Promise.reject(new Error('offline')))}
        navigate={() => undefined}
        now={() => NOW}
      />,
    );
    await screen.findByTestId('cockpit-status');
    expect(screen.queryByLabelText('Project')).toBeNull();
  });

  it('falls back to the default for a project that is not in the list', async () => {
    render(
      <CockpitPage
        sources={sources(undefined, async () => PROJECTS)}
        navigate={() => undefined}
        now={() => NOW}
        initialProjectId="gone"
      />,
    );
    expect(await screen.findByLabelText('Project')).toHaveValue('');
  });
});

describe('the hero verdict', () => {
  const readiness = (verdict: 'go' | 'caution' | 'no-go') =>
    vi.fn(
      async () =>
        ({
          verdict,
          reasons: [
            {
              code: 'pass-rate',
              level: 'no-go',
              message: 'Pass rate 73.5% is below the 80% floor',
              evidence: '',
            },
          ],
        }) as never,
    );

  it('leads the page with the release verdict, one reason and one action', async () => {
    const navigate = vi.fn();
    render(
      <CockpitPage
        sources={{ ...sources(), readiness: readiness('no-go') }}
        navigate={navigate}
        now={() => NOW}
      />,
    );
    const hero = await screen.findByRole('region', { name: 'No-go' });
    expect(hero).toHaveTextContent('Pass rate 73.5% is below the 80% floor');
    const action = within(hero).getByRole('button', { name: 'See what is blocking' });
    action.click();
    expect(navigate).toHaveBeenCalledWith('/dashboard');
    // It comes before the focus list, so it is the first thing read.
    const focus = await screen.findByTestId('now-page');
    expect(hero.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no hero when the page has no readiness to read', async () => {
    show();
    await screen.findByTestId('now-page');
    expect(screen.queryByRole('region', { name: /No-go|Ready|Caution/u })).toBeNull();
  });
});
