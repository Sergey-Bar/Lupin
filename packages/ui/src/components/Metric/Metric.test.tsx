import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Metric } from './Metric.js';

describe('Metric', () => {
  it('says the value, its unit, the change and what it is compared with, in one reading', () => {
    render(
      <Metric label="Pass rate" value="94.2" unit="%" delta={-3.1} comparedWith="last week" />,
    );
    const metric = screen.getByRole('group', { name: 'Pass rate' });
    expect(metric).toHaveTextContent('94.2%');
    expect(within(metric).getByText('−3.1')).toHaveClass('text-danger');
    expect(metric).toHaveTextContent('vs last week');
    expect(within(metric).getByText('94.2')).toHaveClass('tabular-nums');
  });

  it('reads a rise as good unless the metric says lower is better', () => {
    const { rerender } = render(<Metric label="Flaky" value="4" delta={2} />);
    expect(screen.getByText('+2')).toHaveClass('text-success');
    rerender(<Metric label="Flaky" value="4" delta={2} lowerIsBetter />);
    expect(screen.getByText('+2')).toHaveClass('text-danger');
  });

  it('draws no change at all when there is nothing to compare with', () => {
    render(<Metric label="Runs" value="25" />);
    expect(screen.getByRole('group', { name: 'Runs' }).textContent).toBe('25Runs');
  });
});
