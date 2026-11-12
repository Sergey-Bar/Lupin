import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveDot, Status, statusOf } from './Status.js';

describe('statusOf, the one table from a run state to a mark and a word', () => {
  it.each([
    ['passed', 'good', 'Passed'],
    ['failed', 'bad', 'Failed'],
    ['flaky', 'warn', 'Unstable'],
    ['blocked', 'bad', 'Blocked'],
    ['cancelled', 'unknown', 'Cancelled'],
    ['timed_out', 'bad', 'Timed out'],
    ['infra_failed', 'bad', 'Infra failed'],
    ['running', 'info', 'Running'],
    ['queued', 'unknown', 'Queued'],
    ['gate_evaluation', 'info', 'Checking gate'],
  ] as const)('maps %s to a %s mark and the word %s', (state, tone, word) => {
    expect(statusOf(state)).toMatchObject({ tone, word });
  });

  it('marks only work in progress as live', () => {
    expect(statusOf('running').live).toBe(true);
    expect(statusOf('collecting').live).toBe(true);
    expect(statusOf('passed').live).toBe(false);
    expect(statusOf('queued').live).toBe(false);
  });

  it('names a state it does not know rather than calling it a verdict', () => {
    expect(statusOf('something_new')).toMatchObject({ tone: 'unknown', word: 'Something new' });
    expect(statusOf(null)).toMatchObject({ tone: 'unknown', word: 'Pending' });
  });
});

describe('Status, the pill', () => {
  it('draws a shaped mark and the word together, never colour alone', () => {
    render(<Status state="failed" />);
    const pill = screen.getByText('Failed').closest('[data-status]') as HTMLElement;
    expect(pill).toHaveAttribute('data-status', 'bad');
    // The square for a failure, from StatusDot.
    expect(pill.querySelector('[aria-hidden="true"]')).toHaveClass('rounded-xs');
  });

  it('comes in two sizes: a table row and a status band', () => {
    const { rerender } = render(<Status state="passed" />);
    expect(screen.getByText('Passed').closest('[data-status]')).toHaveClass('text-xs');
    rerender(<Status state="passed" size="lg" />);
    expect(screen.getByText('Passed').closest('[data-status]')).toHaveClass('text-sm');
  });

  it('writes the word in the tone colour, on a tint of it, from tokens only', () => {
    render(<Status state="passed" />);
    expect(screen.getByText('Passed').closest('[data-status]')).toHaveClass(
      'text-success',
      'bg-success/10',
    );
  });

  it('pulses only while running, and not under reduced motion', () => {
    render(<Status state="running" />);
    const mark = screen.getByText('Running').closest('[data-status]')?.querySelector('span');
    expect(mark).toHaveClass('animate-lupin-pulse', 'motion-reduce:animate-none');
  });

  it('passes a test id through, so existing tests and tools keep finding it', () => {
    render(<Status state="failed" data-testid="run-outcome-r1" />);
    expect(screen.getByTestId('run-outcome-r1')).toHaveTextContent('Failed');
  });
});

describe('LiveDot', () => {
  it('says Live with a pulsing mark, and Reconnecting without one', () => {
    const { rerender } = render(<LiveDot live />);
    expect(screen.getByText('Live').previousElementSibling).toHaveClass('animate-lupin-pulse');
    rerender(<LiveDot live={false} />);
    expect(screen.getByText('Reconnecting').previousElementSibling).not.toHaveClass(
      'animate-lupin-pulse',
    );
  });

  it('is a polite status, so a dropped connection is announced', () => {
    render(<LiveDot live={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
  });
});
