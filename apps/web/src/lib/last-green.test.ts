import { describe, expect, it } from 'vitest';
import { branchHistory } from './last-green.js';

type Mini = {
  id: string;
  branch: string | null;
  commit: string | null;
  outcome: string | null;
  createdAt: string;
};

function r(id: string, outcome: string, minute: number, branch = 'main'): Mini {
  return {
    id,
    branch,
    commit: `c${id}`,
    outcome,
    createdAt: `2026-11-09T10:${String(minute).padStart(2, '0')}:00.000Z`,
  };
}

describe('branchHistory', () => {
  it('finds the last green before the run, and the first red after it', () => {
    const runs = [
      r('5', 'failed', 5),
      r('4', 'failed', 4),
      r('3', 'failed', 3),
      r('2', 'passed', 2),
      r('1', 'failed', 1),
      r('x', 'passed', 4, 'other'),
    ];
    expect(branchHistory(runs[0]!, runs)).toEqual({ lastGreen: runs[3], firstRed: runs[2] });
  });

  it('ignores runs after this one, and other branches', () => {
    const runs = [r('9', 'passed', 9), r('5', 'failed', 5), r('x', 'passed', 4, 'other')];
    expect(branchHistory(runs[1]!, runs)).toEqual({ lastGreen: null, firstRed: runs[1] });
  });

  it('says nothing for a run with no branch', () => {
    const run = { ...r('5', 'failed', 5), branch: null };
    expect(branchHistory(run, [run, r('2', 'passed', 2)])).toEqual({
      lastGreen: null,
      firstRed: null,
    });
  });
});
