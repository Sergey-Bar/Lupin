/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { DailyBars } from './DailyBars';
import { shortDate } from '../lib/insights';

const days = [
  { date: '2026-11-01', value: 2 },
  { date: '2026-11-02', value: 0 },
  { date: '2026-11-03', value: 4 },
];

describe('DailyBars', () => {
  it('draws one bar per day, scaled to the busiest day, and names the shape in words', () => {
    render(<DailyBars days={days} label="Flaky results per day" tone="text-chart-flaky" />);
    const bars = screen.getAllByTestId('daily-bar');
    expect(bars).toHaveLength(3);
    expect(bars[2]).toHaveStyle({ height: '100%' });
    expect(bars[0]).toHaveStyle({ height: '50%' });
    expect(screen.getByRole('img')).toHaveAccessibleName(
      `Flaky results per day: 6 over 3 days, most on ${shortDate('2026-11-03')} (4).`,
    );
  });

  it('keeps every number readable to a screen reader as a table', () => {
    render(<DailyBars days={days} label="Flaky results per day" tone="text-chart-flaky" />);
    const table = screen.getByRole('table', { name: 'Flaky results per day' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });

  it('says there was none rather than drawing a flat line of nothing', () => {
    render(
      <DailyBars
        days={[{ date: '2026-11-01', value: 0 }]}
        label="Flaky results per day"
        tone="text-chart-flaky"
      />,
    );
    expect(screen.getByText('None in this window.')).toBeInTheDocument();
    expect(screen.queryAllByTestId('daily-bar')).toHaveLength(0);
  });
});

describe('DailyBars, compared with the days before', () => {
  const series = (values: number[]) =>
    values.map((value, index) => ({
      date: `2026-11-${String(index + 1).padStart(2, '0')}`,
      value,
    }));

  it('compares the recent half of the window with the half before it', () => {
    render(<DailyBars days={series([1, 1, 1, 1, 3, 3, 3, 3])} label="Failed results" tone="" />);
    const compare = screen.getByTestId('daily-compare');
    expect(compare).toHaveTextContent('12 in the last 4 days, vs 4 in the 4 before');
    // More failures is worse: the change is drawn as bad.
    expect(within(compare).getByText('+8')).toHaveClass('text-danger');
  });

  it('says a fall in failures is good', () => {
    render(<DailyBars days={series([5, 5, 0, 1])} label="Failed results" tone="" />);
    expect(within(screen.getByTestId('daily-compare')).getByText('−9')).toHaveClass('text-success');
  });
});
