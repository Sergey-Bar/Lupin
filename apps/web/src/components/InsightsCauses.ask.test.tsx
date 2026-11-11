import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FailureClustersPanel } from './InsightsCauses.js';
import { CopilotProvider } from './CopilotPanel.js';

const CLUSTERS = {
  clusters: [
    {
      signature: 's1',
      errorType: null,
      sampleMessage: 'expected status 200, received 502',
      count: 3,
      tests: ['t1'],
      branches: ['main'],
      runs: 2,
      firstSeen: '2026-11-09T00:00:00.000Z',
      lastSeen: '2026-11-10T00:00:00.000Z',
    },
  ],
  totals: { failures: 3, clusters: 1, unlabelled: 1 },
};

describe('a failure cause asks the copilot', () => {
  it('sends the cause message, quoted, to the panel', async () => {
    const askImpl = vi.fn(async () => ({
      source: 'rules' as const,
      answer: 'It failed 3 times.',
      citations: [],
      links: [],
    }));
    render(
      <CopilotProvider askImpl={askImpl}>
        <FailureClustersPanel clusters={CLUSTERS as never} />
      </CopilotProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask Lupin' }));
    expect(askImpl).toHaveBeenCalledWith('Why does "expected status 200, received 502" fail?');
    expect(await screen.findByText('It failed 3 times.')).toBeInTheDocument();
  });

  it('offers nothing outside the shell, where no panel would open', () => {
    render(<FailureClustersPanel clusters={CLUSTERS as never} />);
    expect(screen.queryByRole('button', { name: 'Ask Lupin' })).toBeNull();
  });
});
