import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { INDICATOR_ACTIVE_ATTRIBUTE, useSlidingIndicator } from './use-sliding-indicator.js';

/** jsdom has no layout, so `offsetLeft` and `offsetWidth` are written by hand. */
function lay(element: HTMLElement, left: number, width: number): void {
  Object.defineProperty(element, 'offsetLeft', { configurable: true, value: left });
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: width });
}

function Row({ active }: { active: 'a' | 'b' | null }) {
  const ref = useSlidingIndicator<HTMLDivElement>(active);
  return (
    <div ref={ref} data-testid="row">
      {(['a', 'b'] as const).map((key) => (
        <button
          key={key}
          data-testid={key}
          {...(active === key ? { [INDICATOR_ACTIVE_ATTRIBUTE]: 'true' } : {})}
        >
          {key}
        </button>
      ))}
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSlidingIndicator', () => {
  it('writes the active item’s offset and width on the container', () => {
    const { getByTestId, rerender } = render(<Row active={null} />);
    lay(getByTestId('a'), 10, 40);
    lay(getByTestId('b'), 60, 72);
    rerender(<Row active="b" />);
    const row = getByTestId('row');
    expect(row.style.getPropertyValue('--indicator-x')).toBe('60');
    expect(row.style.getPropertyValue('--indicator-w')).toBe('72');
  });

  it('moves to the new item when the active one changes', () => {
    const { getByTestId, rerender } = render(<Row active="a" />);
    lay(getByTestId('a'), 10, 40);
    lay(getByTestId('b'), 60, 72);
    rerender(<Row active="b" />);
    expect(getByTestId('row').style.getPropertyValue('--indicator-x')).toBe('60');
    rerender(<Row active="a" />);
    expect(getByTestId('row').style.getPropertyValue('--indicator-x')).toBe('10');
    expect(getByTestId('row').style.getPropertyValue('--indicator-w')).toBe('40');
  });

  it('collapses the mark when nothing is active', () => {
    const { getByTestId, rerender } = render(<Row active="a" />);
    lay(getByTestId('a'), 10, 40);
    rerender(<Row active={null} />);
    expect(getByTestId('row').style.getPropertyValue('--indicator-w')).toBe('0');
  });

  it('measures again when the container resizes, and stops watching on unmount', () => {
    let notify: () => void = () => undefined;
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe(): void {}
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', FakeObserver);

    const { getByTestId, unmount } = render(<Row active="a" />);
    lay(getByTestId('a'), 10, 40);
    notify();
    expect(getByTestId('row').style.getPropertyValue('--indicator-x')).toBe('10');
    lay(getByTestId('a'), 24, 40);
    notify();
    expect(getByTestId('row').style.getPropertyValue('--indicator-x')).toBe('24');
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
