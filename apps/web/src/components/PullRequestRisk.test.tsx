import { render, screen, waitFor, within } from '@testing-library/react';
import type { PhaseStrip, PullRequestRisk, PullRequestRiskHistory } from '@lupin/shared-contracts';
import { expectOnePrimary } from '../test-utils.js';
import { PullRequestRiskPage } from './PullRequestRisk.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');

const assessment = (overrides: Partial<PullRequestRisk> = {}): PullRequestRisk => ({
  pullRequest: 12,
  headSha: 'b'.repeat(40),
  assessedAt: '2026-11-11T10:00:00.000Z',
  blastRadius: {
    version: 'blast-radius/1',
    sensitiveAreas: [{ area: 'migrations', count: 2, paths: ['db/1.sql', 'db/2.sql'] }],
    teams: ['@acme/data'],
    individualOwners: 1,
    unownedPaths: 0,
    linkedTests: [{ testStableId: 'cart › totals', failures: 3, files: 1 }],
    linkedTestsTotal: 4,
    truncated: true,
  },
  risk: {
    level: 'critical',
    score: 80,
    version: 'change-risk/1',
    factors: [
      {
        id: 'test-tampering',
        kind: 'risk',
        points: 40,
        detail: '1 change weakens the tests: an added skip or focus.',
        evidence: null,
      },
      {
        id: 'ai-authorship',
        kind: 'risk',
        points: 15,
        detail: 'Written by an agent (claude-code).',
        evidence: null,
      },
      {
        id: 'no-human-approval',
        kind: 'risk',
        points: 15,
        detail: 'AI-written and no person has approved it.',
        evidence: null,
      },
      {
        id: 'blast-radius',
        kind: 'risk',
        points: 10,
        detail: 'Touches 1 sensitive area: migrations.',
        evidence: null,
      },
      {
        id: 'findings',
        kind: 'missing',
        points: 0,
        detail: 'No security scan was read for this commit.',
        evidence: null,
      },
    ],
    missing: [],
  },
  ...overrides,
});

function page(
  read: () => Promise<PullRequestRiskHistory>,
  phases: () => Promise<PhaseStrip> = async () => {
    throw new Error('The delivery sync has not read pull request #12');
  },
) {
  return render(
    <PullRequestRiskPage
      projectId="p-1"
      number={12}
      github={{ getPullRequestRisk: read, getPullRequestPhases: phases }}
      now={() => NOW}
    />,
  );
}

describe('PullRequestRiskPage', () => {
  it('leads with the level and its top factor, then lists every factor with its points', async () => {
    const latest = assessment();
    const older = assessment({
      headSha: 'a'.repeat(40),
      assessedAt: '2026-11-10T10:00:00.000Z',
      risk: { ...latest.risk, level: 'medium', score: 25 },
    });
    const { container } = page(async () => ({ pullRequest: 12, latest, history: [latest, older] }));
    const band = await screen.findByRole('region', { name: 'Critical risk' });
    expect(
      within(band).getByText('1 change weakens the tests: an added skip or focus.'),
    ).toBeTruthy();
    const factors = screen.getByRole('list', { name: 'Risk factors' });
    expect(
      within(factors)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '401 change weakens the tests: an added skip or focus.',
      '15Written by an agent (claude-code).',
      '15AI-written and no person has approved it.',
      '10Touches 1 sensitive area: migrations.',
    ]);
    expect(screen.getByText(/No security scan was read/u)).toBeTruthy();
    expectOnePrimary(container);
  });

  it('shows the reach with teams, linked tests and the truncation, and never a person', async () => {
    page(async () => ({ pullRequest: 12, latest: assessment(), history: [assessment()] }));
    await screen.findByRole('region', { name: 'Critical risk' });
    expect(screen.getByText('@acme/data')).toBeTruthy();
    expect(screen.getByText('cart › totals')).toBeTruthy();
    expect(screen.getByText('…and 3 more')).toBeTruthy();
    expect(screen.getByText(/every count here is a lower bound/u)).toBeTruthy();
  });

  it('lists every head it was assessed at, newest first', async () => {
    const latest = assessment();
    const older = assessment({
      headSha: 'a'.repeat(40),
      risk: { ...latest.risk, level: 'medium', score: 25 },
    });
    page(async () => ({ pullRequest: 12, latest, history: [latest, older] }));
    const list = await screen.findByRole('list', { name: 'Assessments, newest first' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Critical risk');
    expect(rows[1]?.textContent).toContain('Medium risk');
    expect(rows[1]?.textContent).toContain('aaaaaaaaaaaa');
  });

  it('zooms from the portfolio to the repository to this pull request, each with its shape', async () => {
    const reading = (shape: 'good' | 'caution' | 'bad', reason: string) => ({
      version: 'shape/1',
      shape,
      freshness: 'fresh' as const,
      measuredAt: '2026-11-11T10:00:00.000Z',
      reason,
      signals: [],
    });
    render(
      <PullRequestRiskPage
        projectId="p-1"
        number={12}
        github={{
          getPullRequestRisk: async () => ({ pullRequest: 12, latest: null, history: [] }),
          getPullRequestPhases: async () => Promise.reject(new Error('not synced')),
        }}
        shapes={{
          getPortfolioShape: async () => ({
            evaluatedAt: '2026-11-11T12:00:00.000Z',
            overall: reading('caution', 'Not measured: tests.'),
            projects: [],
            total: 0,
            truncated: false,
          }),
          getShape: async () => ({
            ...reading('good', 'Fine.'),
            projectId: 'p-1',
            name: 'Shop',
            pullRequest: null,
          }),
          getPullRequestShape: async () => ({
            ...reading('bad', 'Change risk critical, 90 points.'),
            projectId: 'p-1',
            name: 'Shop',
            pullRequest: 12,
          }),
        }}
        now={() => NOW}
      />,
    );
    const zoom = await screen.findByRole('navigation', { name: 'Zoom' });
    await waitFor(() =>
      expect(
        within(zoom)
          .getAllByRole('listitem')
          .map((level) => level.textContent),
      ).toEqual(['PortfolioCaution', '/ShopGood', '/#12Bad']),
    );
    expect(within(zoom).getByRole('link', { name: 'Shop' })).toHaveAttribute(
      'href',
      '/dashboard/repo/p-1/overview',
    );
    expect(screen.getByTestId('zoom-reason')).toHaveTextContent('Change risk critical, 90 points.');
  });

  it('says a pull request the gate never assessed was not assessed, and how to change that', async () => {
    // The page's own clock, for once: nothing here reads the time.
    render(
      <PullRequestRiskPage
        projectId="p-1"
        number={12}
        github={{
          getPullRequestRisk: async () => ({ pullRequest: 12, latest: null, history: [] }),
          getPullRequestPhases: async () => Promise.reject(new Error('not synced')),
        }}
      />,
    );
    expect(await screen.findByText('Not assessed yet')).toBeTruthy();
    expect(screen.getByText(/lupin gate --pr 12/u)).toBeTruthy();
  });

  it('says an unknown risk is unknown and what was missing', async () => {
    const unknown = assessment({
      blastRadius: null,
      risk: {
        level: 'unknown',
        score: 0,
        version: 'change-risk/1',
        factors: [],
        missing: ['tests'],
      },
    });
    page(async () => ({ pullRequest: 12, latest: unknown, history: [unknown] }));
    expect(await screen.findByRole('region', { name: 'Risk unknown' })).toBeTruthy();
    expect(screen.getByText(/Not measured: test results/u)).toBeTruthy();
    expect(screen.getByText(/its reach is not known/u)).toBeTruthy();
  });

  it('says when nothing sensitive was touched, no team owns it, or there is no CODEOWNERS', async () => {
    const quiet = (unownedPaths: number | null, teams: string[]) =>
      assessment({
        blastRadius: {
          version: 'blast-radius/1',
          sensitiveAreas: [{ area: 'auth', count: 1, paths: ['a.ts'] }],
          teams,
          individualOwners: null,
          unownedPaths,
          linkedTests: [{ testStableId: 't', failures: 1, files: 1 }],
          linkedTestsTotal: 1,
          truncated: false,
        },
        risk: {
          level: 'low',
          score: 0,
          version: 'change-risk/1',
          factors: [
            {
              id: 'diff-coverage',
              kind: 'missing',
              points: 0,
              detail: 'Not measured.',
              evidence: null,
            },
          ],
          missing: ['diff-coverage'],
        },
      });
    const first = page(async () => ({ pullRequest: 12, latest: quiet(null, []), history: [] }));
    expect(await screen.findByText(/No CODEOWNERS file/u)).toBeTruthy();
    expect(screen.getByText('No factor adds to this change’s risk.')).toBeTruthy();
    expect(screen.getByText('1 file')).toBeTruthy();
    expect(screen.getByText('1 failure')).toBeTruthy();
    expect(screen.getByText(/\(required\)/u)).toBeTruthy();
    first.unmount();
    page(async () => ({ pullRequest: 12, latest: quiet(3, []), history: [] }));
    expect(await screen.findByText('No team owns these files.')).toBeTruthy();
  });

  it('says no sensitive area was touched and no test failed with the files', async () => {
    const none = assessment({
      blastRadius: {
        version: 'blast-radius/1',
        sensitiveAreas: [],
        teams: [],
        individualOwners: 0,
        unownedPaths: 0,
        linkedTests: [],
        linkedTestsTotal: 0,
        truncated: false,
      },
    });
    page(async () => ({ pullRequest: 12, latest: none, history: [none] }));
    expect(await screen.findByText('None touched.')).toBeTruthy();
    expect(screen.getByText('None recorded.')).toBeTruthy();
  });

  it('shows the server’s own sentence when the read fails', async () => {
    page(async () => {
      throw new Error('No project p-1');
    });
    expect(await screen.findByText('The change risk could not be read')).toBeTruthy();
  });
});
