import { render, screen, within } from '@testing-library/react';
import type {
  PhaseBandEntry,
  PhaseStrip,
  PortfolioPhases,
  RepositoryPhases,
} from '@lupin/shared-contracts';
import { PhaseBandPanel, PhaseStripPanel, PhaseStripView, PortfolioPhasesPanel } from './Phases.js';

const PHASES = ['plan', 'code', 'test', 'review', 'release'] as const;

const strip: PhaseStrip = {
  version: 'sdlc/1',
  pullRequest: 12,
  shape: 'bad',
  skipped: ['review'],
  phases: [
    { phase: 'plan', state: 'not_measured', hours: null, shape: 'unknown', reason: 'Not read.' },
    { phase: 'code', state: 'done', hours: 4, shape: 'good', reason: 'Opened for review.' },
    { phase: 'test', state: 'done', hours: null, shape: 'good', reason: 'Tests ran.' },
    {
      phase: 'review',
      state: 'skipped',
      hours: null,
      shape: 'bad',
      reason: 'No person approved it.',
    },
    { phase: 'release', state: 'done', hours: 72, shape: 'good', reason: 'Merged.' },
  ],
};

const band = (overrides: Partial<PhaseBandEntry> = {}): PhaseBandEntry[] =>
  PHASES.map((phase) => ({
    phase,
    shape: 'good',
    measured: 3,
    done: 3,
    skipped: 0,
    stuck: 0,
    medianHours: 5,
    reason: `3 of 3 changes done ${phase}.`,
    ...(phase === 'review' ? overrides : {}),
  }));

const repository = (overrides: Partial<RepositoryPhases> = {}): RepositoryPhases => ({
  projectId: 'p',
  version: 'sdlc/1',
  evaluatedAt: '2026-11-11T12:00:00.000Z',
  windowDays: 30,
  changes: 3,
  phases: band(),
  bottleneck: null,
  stuck: [],
  truncated: false,
  configured: true,
  ...overrides,
});

describe('PhaseStripView', () => {
  it('draws every phase with its word, its time and its reason, never colour alone', () => {
    render(<PhaseStripView strip={strip} />);
    const items = within(screen.getByRole('list', { name: 'SDLC phases' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'PlanNot measuredNot read.',
      'CodeDone · 4 hOpened for review.',
      'TestDoneTests ran.',
      'ReviewSkippedNo person approved it.',
      'ReleaseDone · 3 dMerged.',
    ]);
  });

  it('says why the strip is missing, and that it is reading', () => {
    const { rerender } = render(
      <PhaseStripPanel strip={{ status: 'error', message: 'The delivery sync has not read it' }} />,
    );
    expect(screen.getByText('The delivery sync has not read it')).toBeTruthy();
    rerender(<PhaseStripPanel strip={{ status: 'loading' }} />);
    expect(screen.getByText('Reading the phases…')).toBeTruthy();
    rerender(<PhaseStripPanel strip={{ status: 'ready', value: strip }} />);
    expect(screen.getByRole('list', { name: 'SDLC phases' })).toBeTruthy();
  });
});

describe('PhaseBandPanel', () => {
  it('leads with the bottleneck and lists what is stuck, longest first', () => {
    render(
      <PhaseBandPanel
        phases={{
          status: 'ready',
          value: repository({
            phases: band({ shape: 'caution', stuck: 2, reason: '2 of 3 changes stuck in review.' }),
            bottleneck: {
              phase: 'review',
              sentence: 'Review is the bottleneck: 2 changes waiting over 48 hours.',
            },
            stuck: [
              { pullRequest: 4, title: 'Cart', phase: 'review', hours: 100 },
              { pullRequest: 5, title: 'Pay', phase: 'review', hours: 60 },
            ],
            truncated: true,
          }),
        }}
      />,
    );
    expect(
      screen.getByText('Review is the bottleneck: 2 changes waiting over 48 hours.'),
    ).toBeTruthy();
    const stuck = within(screen.getByRole('list', { name: 'Stuck changes' })).getAllByRole(
      'listitem',
    );
    expect(stuck.map((item) => item.textContent)).toEqual([
      '#4CartReview · 4 d',
      '#5PayReview · 3 d',
    ]);
    expect(screen.getByText(/every count is a lower bound/u)).toBeTruthy();
  });

  it('says nothing is holding changes up, and what to do with no sync', () => {
    const { rerender } = render(
      <PhaseBandPanel phases={{ status: 'ready', value: repository() }} />,
    );
    expect(
      screen.getByText('No phase is holding changes up across 3 changes in 30 days.'),
    ).toBeTruthy();
    rerender(
      <PhaseBandPanel phases={{ status: 'ready', value: repository({ configured: false }) }} />,
    );
    expect(screen.getByText(/turn on delivery sync/u)).toBeTruthy();
    rerender(<PhaseBandPanel phases={{ status: 'error', message: 'nope' }} />);
    expect(screen.getByRole('alert').textContent).toContain('nope');
    rerender(<PhaseBandPanel phases={{ status: 'loading' }} />);
    expect(screen.getByText('Reading the phases…')).toBeTruthy();
  });
});

describe('PortfolioPhasesPanel', () => {
  const portfolio = (overrides: Partial<PortfolioPhases> = {}): PortfolioPhases => ({
    evaluatedAt: '2026-11-11T12:00:00.000Z',
    windowDays: 30,
    total: 2,
    truncated: false,
    projects: [
      {
        projectId: 'a',
        name: 'Shop',
        changes: 4,
        configured: true,
        phases: PHASES.map((phase) => ({ phase, shape: phase === 'review' ? 'bad' : 'good' })),
      },
      {
        projectId: 'b',
        name: 'Quiet',
        changes: 0,
        configured: false,
        phases: PHASES.map((phase) => ({ phase, shape: 'unknown' })),
      },
    ],
    ...overrides,
  });

  it('shows each repository’s shape per phase, and an unsynced one as not synced', () => {
    render(<PortfolioPhasesPanel phases={{ status: 'ready', value: portfolio() }} />);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]?.textContent).toBe('ShopGoodGoodGoodBadGood');
    expect(rows[2]?.textContent).toContain('Not synced');
  });

  it('says when it shows only some, and when there is nothing, and its read states', () => {
    const { rerender } = render(
      <PortfolioPhasesPanel
        phases={{ status: 'ready', value: portfolio({ truncated: true, total: 60 }) }}
      />,
    );
    expect(screen.getByText('Showing 2 of 60 repositories.')).toBeTruthy();
    rerender(
      <PortfolioPhasesPanel
        phases={{ status: 'ready', value: portfolio({ projects: [], total: 0 }) }}
      />,
    );
    expect(screen.getByText('No repository is registered yet.')).toBeTruthy();
    rerender(<PortfolioPhasesPanel phases={{ status: 'error', message: 'down' }} />);
    expect(screen.getByRole('alert').textContent).toContain('down');
    rerender(<PortfolioPhasesPanel phases={{ status: 'loading' }} />);
    expect(screen.getByText('Reading the phases…')).toBeTruthy();
  });
});
