import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QualityPulse } from '@lupin/shared-contracts';
import { PulseLine } from './PulseLine.js';

function pulse(overrides: Partial<QualityPulse> = {}): QualityPulse {
  return {
    projectId: 'p1',
    evaluatedAt: '2026-11-26T12:00:00.000Z',
    windowDays: 7,
    direction: 'worse',
    confidence: 'medium',
    cause: { vital: 'pass-rate', text: 'Pass rate fell 50.0 pts' },
    sentence: 'Worse: Pass rate fell 50.0 pts.',
    vitals: [],
    alsoMoved: [],
    ...overrides,
  };
}

describe('PulseLine', () => {
  it('says the direction and the reason, against which window, and how sure it is', async () => {
    render(<PulseLine load={async () => pulse()} projectId="p1" />);
    const line = await screen.findByTestId('pulse-line');
    expect(line).toHaveAttribute('data-direction', 'worse');
    expect(line).toHaveTextContent('Worse: Pass rate fell 50.0 pts.');
    expect(line).toHaveTextContent('Last 7 days against the 7 before');
    expect(line).toHaveTextContent('medium confidence');
  });

  it('never lets a "worse" hide what also improved', async () => {
    render(
      <PulseLine
        load={async () =>
          pulse({
            alsoMoved: [
              { vital: 'coverage', text: 'Coverage rose 2.0 pts' },
              { vital: 'flaky-rate', text: 'Flaky rate fell 1.5 pts' },
            ],
          })
        }
        projectId="p1"
      />,
    );
    expect(await screen.findByTestId('pulse-also')).toHaveTextContent(
      'Also moved: Coverage rose 2.0 pts; Flaky rate fell 1.5 pts',
    );
  });

  it('says unknown plainly, without a verdict colour', async () => {
    render(
      <PulseLine
        load={async () =>
          pulse({
            direction: 'unknown',
            cause: null,
            confidence: 'low',
            sentence: 'Unknown: Not enough evidence in both windows to compare.',
          })
        }
        projectId="p1"
      />,
    );
    const line = await screen.findByTestId('pulse-line');
    expect(line).toHaveAttribute('data-direction', 'unknown');
    expect(screen.queryByTestId('pulse-also')).toBeNull();
  });

  it('draws nothing when there is no project to read', async () => {
    const load = vi.fn(async () => null);
    const { container } = render(<PulseLine load={load} projectId={undefined} />);
    await waitFor(() => expect(load).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(screen.queryByTestId('pulse-loading')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it('says it could not read the pulse rather than implying steady', async () => {
    render(
      <PulseLine
        load={async () => {
          throw new Error('API answered 500');
        }}
        projectId="p1"
      />,
    );
    expect(await screen.findByTestId('pulse-unread')).toHaveTextContent(
      'Lupin could not read whether quality got better or worse',
    );
  });

  it('reads again for another project', async () => {
    const load = vi.fn(async (projectId: string | undefined) =>
      pulse({ projectId: projectId ?? '' }),
    );
    const { rerender } = render(<PulseLine load={load} projectId="p1" />);
    await screen.findByTestId('pulse-line');
    rerender(<PulseLine load={load} projectId="p2" />);
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('p2'));
    expect(await screen.findByTestId('pulse-line')).toBeInTheDocument();
  });
});
