import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BranchHistory } from './BranchHistory.js';
import type { Run } from '../lib/api.js';

function r(id: string, outcome: string, minute: number): Run {
  return {
    id,
    branch: 'main',
    commit: `${id}abcdef0`,
    outcome,
    createdAt: `2026-11-09T10:${String(minute).padStart(2, '0')}:00.000Z`,
  } as Run;
}

describe('BranchHistory', () => {
  it('links the last green and the run where it first failed', async () => {
    const runs = [r('c', 'failed', 3), r('b', 'failed', 2), r('a', 'passed', 1)];
    render(<BranchHistory run={runs[0]!} loadRuns={async () => runs} />);
    await screen.findByTestId('branch-history');
    expect(screen.getByRole('link', { name: 'aabcdef' })).toHaveAttribute(
      'href',
      '/dashboard/runs/a',
    );
    expect(screen.getByRole('link', { name: 'babcdef' })).toHaveAttribute(
      'href',
      '/dashboard/runs/b',
    );
  });

  it('shows nothing when the branch was never green before', async () => {
    const runs = [r('c', 'failed', 3)];
    const { container } = render(<BranchHistory run={runs[0]!} loadRuns={async () => runs} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
