import { render, screen, within } from '@testing-library/react';
import type { PaceReport, PaceWeek } from '@lupin/shared-contracts';
import { PacePanel } from './PacePanel.js';

const week = (overrides: Partial<PaceWeek> = {}): PaceWeek => ({
  weekStart: '2026-11-09T00:00:00.000Z',
  mergedPullRequests: 3,
  changedLines: 2000,
  aiShare: 0.5,
  testedShare: 0.25,
  testsAdded: 4,
  testsPerKloc: 2,
  uncoveredLines: 120,
  unmeasuredLines: 300,
  debt: 140,
  ...overrides,
});

const report = (overrides: Partial<PaceReport> = {}): PaceReport => ({
  projectId: 'p',
  version: 'pace/1',
  evaluatedAt: '2026-11-11T12:00:00.000Z',
  status: 'measured',
  headline: '2,000 lines changed this week (50% AI-written); 4 new tests.',
  weeks: [week({ weekStart: '2026-11-02T00:00:00.000Z', debt: 20, uncoveredLines: 20 }), week()],
  debt: { uncoveredLines: 140, unmeasuredLines: 300 },
  truncated: false,
  ...overrides,
});

describe('PacePanel', () => {
  it('leads with the headline and the debt, then one row per week', () => {
    render(<PacePanel pace={{ status: 'ready', value: report() }} />);
    expect(screen.getByText(/2,000 lines changed this week/u)).toBeTruthy();
    expect(screen.getByText('140')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Pace by week, oldest first' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[2]?.textContent).toContain('50%');
    expect(rows[2]?.textContent).toContain('25%');
  });

  it('says what was not measured, and when the counts are a lower bound', () => {
    render(
      <PacePanel
        pace={{
          status: 'ready',
          value: report({
            status: 'insufficient',
            truncated: true,
            weeks: [week({ testsAdded: null, aiShare: null, testedShare: null })],
          }),
        }}
      />,
    );
    expect(screen.getAllByText('not measured')).toHaveLength(3);
    expect(screen.getByText(/no week to compare with yet/u)).toBeTruthy();
    expect(screen.getByText(/every count is a lower bound/u)).toBeTruthy();
  });

  it('shows only the next step when nothing merged is known, and states loading and errors', () => {
    const { rerender } = render(
      <PacePanel
        pace={{
          status: 'ready',
          value: report({ status: 'not_configured', headline: 'Turn on delivery sync.' }),
        }}
      />,
    );
    expect(screen.getByText('Turn on delivery sync.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    rerender(<PacePanel pace={{ status: 'loading' }} />);
    expect(screen.getByText('Reading the pace…')).toBeTruthy();
    rerender(<PacePanel pace={{ status: 'error', message: 'No project p' }} />);
    expect(screen.getByRole('alert').textContent).toContain('No project p');
  });
});
