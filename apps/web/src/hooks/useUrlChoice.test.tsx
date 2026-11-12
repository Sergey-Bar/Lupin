import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useUrlChoice } from './useUrlChoice.js';

const OPTIONS = ['7', '14', '30'] as const;

afterEach(() => window.history.replaceState(null, '', '/'));

describe('useUrlChoice', () => {
  it('opens on the choice the link carries', () => {
    window.history.replaceState(null, '', '/dashboard/insights?days=30');
    const { result } = renderHook(() => useUrlChoice('days', OPTIONS, '14'));
    expect(result.current[0]).toBe('30');
  });

  it('ignores a value it does not offer, rather than trusting the URL', () => {
    window.history.replaceState(null, '', '/dashboard/insights?days=9999');
    const { result } = renderHook(() => useUrlChoice('days', OPTIONS, '14'));
    expect(result.current[0]).toBe('14');
  });

  it('writes the choice back, keeping the rest of the URL, so the link can be shared', () => {
    window.history.replaceState(null, '', '/dashboard/insights?project=p1');
    const { result } = renderHook(() => useUrlChoice('days', OPTIONS, '14'));
    act(() => result.current[1]('7'));
    expect(result.current[0]).toBe('7');
    expect(window.location.search).toBe('?project=p1&days=7');
  });
});
