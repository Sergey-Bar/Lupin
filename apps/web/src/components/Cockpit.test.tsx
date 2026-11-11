import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cockpit } from '@lupin/shared-contracts';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { cockpitFixture, cockpitMetric } from '../test-utils.js';
import { QaApiError } from '../lib/qa-client.js';
import { greetingFor } from '../lib/focus.js';
import {
  CockpitNumbers,
  CockpitPage,
  HOME_VIEW_KEY,
  safeHref,
  type CockpitSources,
} from './Cockpit.js';
import type { CockpitClient } from '../lib/cockpit-client.js';
import { expectOnePrimary } from '../test-utils.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');

type Getter = CockpitClient['getCockpit'];

function sources(projects: CockpitSources['projects'] = async () => []): CockpitSources {
  return {
    projects,
    attention: {
      runs: vi.fn(async () => []),
      portfolio: vi.fn(async () => ({ projects: [] })),
      deliveries: vi.fn(async () => []),
    },
  };
}

/** The product's numbers, as Health draws them. */
const show = (cockpit: Getter = vi.fn(async () => cockpitFixture()), projectId?: string) =>
  render(<CockpitNumbers cockpit={cockpit} projectId={projectId} />);

/** Home: the verdict and what needs you. */
const showHome = (navigate: (to: string) => void = () => undefined) =>
  render(<CockpitPage sources={sources()} navigate={navigate} now={() => NOW} />);

afterEach(() => {
  localStorage.clear();
});

describe('the headline', () => {
  it('draws at most one solid primary button on the screen', async () => {
    showHome();
    await screen.findByTestId('now-page');
    expect(expectOnePrimary(document.body).length).toBeLessThanOrEqual(1);
  });

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
  });

  it('turns a bare "not found" into what is missing and one next step', async () => {
    const cockpit = vi.fn<Getter>().mockRejectedValue(new QaApiError(404, 'not found'));
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
      .fn<Getter>()
      .mockRejectedValueOnce(new QaApiError(404, 'This workspace has no project to show'))
      .mockResolvedValue(cockpitFixture());
    show(cockpit);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The dashboard could not be read.');
    expect(alert).toHaveTextContent('This workspace has no project to show');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('cockpit-status')).toHaveTextContent('74');
    expect(cockpit).toHaveBeenCalledTimes(2);
  });
});

describe('the home page, as one focus', () => {
  it('greets the reader, then the verdict and what needs you, and nothing after them', async () => {
    showHome();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(greetingFor(NOW));
    const focus = await screen.findByTestId('now-page');
    // No setup checklist, no folded numbers, no window switch: those live in Settings and Health.
    expect(screen.queryByTestId('setup-checklist')).toBeNull();
    expect(screen.queryByTestId('cockpit-everything')).toBeNull();
    expect(screen.queryByTestId('cockpit-numbers')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Compare with' })).toBeNull();
    expect(focus.closest('[data-testid="cockpit-page"]')).not.toBeNull();
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

describe('accessibility', () => {
  it('has no blocking violations once the page has settled', async () => {
    const { container } = show();
    await screen.findByTestId('cockpit-pace');
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
    unmount();
    show(vi.fn(() => Promise.reject(new Error('offline'))));
    await screen.findByRole('alert');
    expect(screen.queryByTestId('cockpit-report')).toBeNull();
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
        sources={sources(async () => PROJECTS)}
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

  it('reads the chosen project and tells the address', async () => {
    const user = userEvent.setup();
    const readiness = vi.fn(async () => ({ verdict: 'go', reasons: [] }) as never);
    const onProjectChange = vi.fn();
    render(
      <CockpitPage
        sources={{ ...sources(async () => PROJECTS), readiness }}
        navigate={() => undefined}
        now={() => NOW}
        onProjectChange={onProjectChange}
      />,
    );
    await user.selectOptions(await screen.findByLabelText('Project'), 'p-2');
    expect(onProjectChange).toHaveBeenCalledWith('p-2');
    await waitFor(() => expect(readiness).toHaveBeenLastCalledWith('p-2'));
  });

  it('reads the numbers for the project it is given, and links its metrics to it', async () => {
    const getCockpit = vi.fn(async () =>
      cockpitFixture({ projectId: 'p-2', projectName: 'Website' }),
    );
    show(getCockpit, 'p-2');
    expect(getCockpit).toHaveBeenCalledWith({ window: '7d', projectId: 'p-2' }, expect.anything());
    const card = await screen.findByTestId('cockpit-metric-coverage');
    expect(within(card).getByRole('link', { name: /Coverage/u })).toHaveAttribute(
      'href',
      '/dashboard/metric/coverage?window=7d&project=p-2',
    );
  });

  it('opens on the project the address names, and goes back to the default on request', async () => {
    const user = userEvent.setup();
    const onProjectChange = vi.fn();
    render(
      <CockpitPage
        sources={sources(async () => PROJECTS)}
        navigate={() => undefined}
        now={() => NOW}
        initialProjectId="p-1"
        onProjectChange={onProjectChange}
      />,
    );
    const select = await screen.findByLabelText('Project');
    expect(select).toHaveValue('p-1');
    await user.selectOptions(select, '');
    expect(onProjectChange).toHaveBeenLastCalledWith(undefined);
  });

  it('shows no picker for one project, or when the list cannot be read', async () => {
    const { unmount } = render(
      <CockpitPage
        sources={sources(async () => [PROJECTS[0] as (typeof PROJECTS)[number]])}
        navigate={() => undefined}
        now={() => NOW}
      />,
    );
    await screen.findByTestId('now-page');
    expect(screen.queryByLabelText('Project')).toBeNull();
    unmount();
    render(
      <CockpitPage
        sources={sources(() => Promise.reject(new Error('offline')))}
        navigate={() => undefined}
        now={() => NOW}
      />,
    );
    await screen.findByTestId('now-page');
    expect(screen.queryByLabelText('Project')).toBeNull();
  });

  it('falls back to the default for a project that is not in the list', async () => {
    render(
      <CockpitPage
        sources={sources(async () => PROJECTS)}
        navigate={() => undefined}
        now={() => NOW}
        initialProjectId="gone"
      />,
    );
    expect(await screen.findByLabelText('Project')).toHaveValue('');
  });
});

describe('the two Home views', () => {
  const clusters = {
    clusters: [
      {
        signature: 'timeout:locator.click',
        message: 'TimeoutError: locator.click',
        count: 4,
        runs: 2,
        tests: ['checkout › pays'],
        firstSeen: '2026-10-24T10:00:00.000Z',
        lastSeen: '2026-10-26T10:00:00.000Z',
        branches: ['main'],
      },
    ],
    totals: { failures: 4, causes: 1 },
    summary: '4 failures, 1 cause',
  } as never;

  it('opens on Triage for an engineer: what needs you, then failures grouped by cause', async () => {
    localStorage.removeItem(HOME_VIEW_KEY);
    render(
      <CockpitPage
        sources={{ ...sources(), clusters: vi.fn(async () => clusters) }}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    const views = screen.getByRole('group', { name: 'Home view' });
    expect(within(views).getByRole('button', { name: 'Triage' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByTestId('clusters-summary')).toHaveTextContent('4 failures, 1 cause');
  });

  it('switches to Release for a lead, and remembers the choice', async () => {
    const user = userEvent.setup();
    localStorage.removeItem(HOME_VIEW_KEY);
    const readiness = vi.fn(
      async () =>
        ({
          verdict: 'caution',
          reasons: [
            {
              code: 'q',
              level: 'caution',
              message: '2 quarantined tests await a decision',
              evidence: '',
            },
            { code: 'ok', level: 'go', message: 'Coverage holds', evidence: '' },
            {
              code: 'p',
              level: 'no-go',
              message: 'Pass rate 78% is below the 80% floor',
              evidence: '',
            },
          ],
        }) as never,
    );
    const { unmount } = render(
      <CockpitPage
        sources={{ ...sources(), clusters: vi.fn(async () => clusters), readiness }}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Release' }));
    expect(await screen.findByRole('region', { name: 'Caution' })).toBeInTheDocument();
    const why = await screen.findByRole('list', { name: 'Why this decision' });
    expect(
      within(why)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Pass rate 78% is below the 80% floor', '2 quarantined tests await a decision']);
    expect(screen.queryByTestId('clusters-summary')).toBeNull();
    expect(localStorage.getItem(HOME_VIEW_KEY)).toBe('release');
    unmount();
    render(
      <CockpitPage
        sources={{ ...sources(), clusters: vi.fn(async () => clusters), readiness }}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    expect(screen.getByRole('button', { name: 'Release' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the failure trend on Release, compared with the half before, for the lead', async () => {
    const user = userEvent.setup();
    localStorage.removeItem(HOME_VIEW_KEY);
    const trend = vi.fn(async () =>
      [1, 1, 1, 1, 3, 3, 3, 3].map((failed, index) => ({
        date: `2026-10-${String(19 + index)}`,
        failed,
      })),
    );
    render(<CockpitPage sources={{ ...sources(), trend }} navigate={vi.fn()} now={() => NOW} />);
    expect(screen.queryByTestId('release-trend')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Release' }));
    const panel = await screen.findByTestId('release-trend');
    expect(within(panel).getByTestId('daily-compare')).toHaveTextContent(
      '12 in the last 4 days, vs 4 in the 4 before',
    );
    expect(trend).toHaveBeenCalledWith(undefined);
  });

  it('carries the week’s briefing on Release only, for the project chosen', async () => {
    const user = userEvent.setup();
    localStorage.removeItem(HOME_VIEW_KEY);
    const briefing = vi.fn(async () => ({
      briefing: {
        version: 'briefing/1',
        scope: { kind: 'portfolio' as const, projects: 2 },
        windowDays: 7,
        generatedAt: NOW.toISOString(),
        shape: 'bad' as const,
        headline: '4 pull requests merged, 3 AI-written.',
        items: [
          {
            id: 'riskier.tampered',
            section: 'riskier' as const,
            tone: 'bad' as const,
            text: '1 merged with changes that weakened its tests.',
            evidence: ['diff-guard:portfolio:7d'],
            link: '/dashboard/prs',
          },
        ],
      },
      narration: null,
    }));
    render(<CockpitPage sources={{ ...sources(), briefing }} navigate={vi.fn()} now={() => NOW} />);
    expect(screen.queryByTestId('briefing-card')).toBeNull();
    expect(briefing).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Release' }));
    const card = await screen.findByTestId('briefing-card');
    expect(await within(card).findByText('4 pull requests merged, 3 AI-written.')).toBeVisible();
    expect(within(card).getByText('1 merged with changes that weakened its tests.')).toBeVisible();
    expect(briefing).toHaveBeenCalledWith(undefined);
    expect(expectOnePrimary(document.body).length).toBeLessThanOrEqual(1);
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
    // The focus card below owns the one primary fill; the hero's way in is an edge.
    expect(action).toHaveClass('border-border-strong');
    expect(action).not.toHaveClass('bg-primary-gradient');
    // With nothing to act on, the focus list says nothing under the verdict: no "All clear"
    // beside a No-go.
    await waitFor(() => expect(screen.queryByTestId('now-loading')).toBeNull());
    expect(screen.queryByTestId('now-clear')).toBeNull();
  });

  it('says an unreadable verdict in a sentence, never as the server’s bare word', async () => {
    render(
      <CockpitPage
        sources={{
          ...sources(),
          readiness: vi.fn(() => Promise.reject(new QaApiError(404, 'not found'))),
        }}
        navigate={vi.fn()}
        now={() => NOW}
      />,
    );
    const hero = await screen.findByRole('region', { name: 'Not measured' });
    expect(hero).toHaveTextContent('Lupin could not read the release gates (not found).');
  });

  it('draws no hero when the page has no readiness to read', async () => {
    showHome();
    await screen.findByTestId('now-page');
    expect(screen.queryByRole('region', { name: /No-go|Ready|Caution/u })).toBeNull();
  });
});
