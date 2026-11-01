import { render, screen, waitFor, within } from '@testing-library/react';
import type { QaClient } from '../../lib/qa-client.js';
import type {
  QaFlakyResponse,
  QaGapsResponse,
  QaHollowResponse,
  QaStructureResponse,
} from '../../lib/qa.js';
import { FlakyPage, GapsPage, HollowPage, StructurePage } from './gaps.js';

/**
 * The four deep-dive screens. Each owes the same three states — loading, the server's own
 * failure sentence, and its rows — and two of them owe an honest empty state, which is a
 * different claim from "nothing loaded".
 */
const GAPS: QaGapsResponse = {
  cappedBy: 'e2e coverage',
  gaps: [
    {
      cell: 'checkout.e2e',
      category: 'e2e',
      surface: 'checkout',
      current: 0.25,
      potential: 0.12,
      cheapestClosure: 'add a Playwright spec for the happy path',
    },
    {
      cell: 'auth.unit',
      category: 'unit',
      surface: 'auth',
      current: 0.6,
      potential: 0.05,
      cheapestClosure: 'cover the token refresh branch',
    },
  ],
};
const HOLLOW: QaHollowResponse = {
  cells: [{ cell: 'cart.unit', hollowFingerprints: ['hollow-1', 'hollow-2'], signal: 0.1 }],
};
const FLAKY: QaFlakyResponse = {
  cells: [{ cell: 'search.e2e', flakyFingerprints: ['fp-9'], flakeRate: 0.3, stability: 0.7 }],
};
const STRUCTURE: QaStructureResponse = {
  findings: [
    {
      kind: 'single_layer_dependency',
      cells: ['billing.unit'],
      statement: 'billing is tested at one layer only',
      impact: 0.4,
    },
  ],
};

function client(overrides: Partial<QaClient> = {}): QaClient {
  return {
    getGaps: vi.fn().mockResolvedValue(GAPS),
    getHollow: vi.fn().mockResolvedValue(HOLLOW),
    getFlaky: vi.fn().mockResolvedValue(FLAKY),
    getStructure: vi.fn().mockResolvedValue(STRUCTURE),
    ...overrides,
  } as unknown as QaClient;
}

describe('the gap queue', () => {
  it('asks for the project it was given, and keeps the order the server ranked', async () => {
    const api = client();
    render(<GapsPage api={api} projectId="p-1" />);
    await waitFor(() => expect(screen.getByText('checkout.e2e')).toBeInTheDocument());
    expect(api.getGaps).toHaveBeenCalledWith('p-1');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual([
      'checkout.e2e',
      'auth.unit',
    ]);
    expect(screen.getByText('+12 pts')).toBeInTheDocument();
    expect(screen.getByText(/Capped by e2e coverage\./)).toBeInTheDocument();
  });

  it('says there is nothing to fix when the queue is empty, rather than drawing an empty table', async () => {
    render(
      <GapsPage
        api={client({ getGaps: vi.fn().mockResolvedValue({ ...GAPS, gaps: [] }) })}
        projectId="p"
      />,
    );
    await waitFor(() => expect(screen.getByText('Nothing to fix')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it("shows the server's own words when it fails", async () => {
    render(
      <GapsPage
        api={client({ getGaps: vi.fn().mockRejectedValue(new Error('score not computed yet')) })}
        projectId="p"
      />,
    );
    await waitFor(() => expect(screen.getByText('Could not load the gaps')).toBeInTheDocument());
    expect(screen.getByText('score not computed yet')).toBeInTheDocument();
  });

  it('names the screen while it loads', () => {
    render(
      <GapsPage api={client({ getGaps: () => new Promise(() => undefined) })} projectId="p" />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Automation gaps' })).toBeInTheDocument();
  });
});

describe('the registers', () => {
  it('lists hollow tests by identity, not as a count', async () => {
    render(<HollowPage api={client()} projectId="p" />);
    await waitFor(() => expect(screen.getByText('cart.unit')).toBeInTheDocument());
    expect(screen.getByText('hollow-1, hollow-2')).toBeInTheDocument();
  });

  it('puts the flake rate beside the fingerprints it describes', async () => {
    render(<FlakyPage api={client()} projectId="p" />);
    await waitFor(() => expect(screen.getByText('search.e2e')).toBeInTheDocument());
    const row = screen.getByText('search.e2e').closest('tr');
    expect(row?.textContent).toContain('fp-9');
    expect(row?.textContent).toContain('0.30');
  });

  it('reports structural findings, and says so plainly when there are none', async () => {
    const { unmount } = render(<StructurePage api={client()} projectId="p" />);
    await waitFor(() =>
      expect(screen.getByText('billing is tested at one layer only')).toBeInTheDocument(),
    );
    unmount();
    render(
      <StructurePage
        api={client({ getStructure: vi.fn().mockResolvedValue({ findings: [] }) })}
        projectId="p"
      />,
    );
    await waitFor(() => expect(screen.getByText('No structural findings')).toBeInTheDocument());
  });
});
