import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { adjacentSection, useSectionWheel, WHEEL_THRESHOLD } from './useSectionWheel.js';

describe('adjacentSection', () => {
  it('steps through the sections in rail order and stops at both ends', () => {
    expect(adjacentSection('overview', 1)).toBe('/dashboard/runs');
    expect(adjacentSection('runs', -1)).toBe('/dashboard/now');
    expect(adjacentSection('settings', 1)).toBeNull();
    expect(adjacentSection('overview', -1)).toBeNull();
    expect(adjacentSection(null, 1)).toBeNull();
  });
});

function Harness({ go, section }: { go: (path: string) => void; section: 'runs' }) {
  const ref = useSectionWheel<HTMLDivElement>(section, go);
  return (
    <div ref={ref} data-testid="frame">
      <div data-testid="inner" style={{ overflowY: 'auto' }}>
        rows
      </div>
    </div>
  );
}

function scrollable(element: HTMLElement, top: number, height: number, client: number) {
  Object.defineProperties(element, {
    scrollTop: { value: top, configurable: true },
    scrollHeight: { value: height, configurable: true },
    clientHeight: { value: client, configurable: true },
  });
}

describe('useSectionWheel', () => {
  it('moves one category per wheel step, in the direction of the wheel', () => {
    const go = vi.fn();
    const { getByTestId } = render(<Harness go={go} section="runs" />);
    fireEvent.wheel(getByTestId('frame'), { deltaY: WHEEL_THRESHOLD + 1 });
    expect(go).toHaveBeenCalledWith('/dashboard/insights');
  });

  it('ignores a small nudge, so a trackpad tremor does not change the screen', () => {
    const go = vi.fn();
    const { getByTestId } = render(<Harness go={go} section="runs" />);
    fireEvent.wheel(getByTestId('frame'), { deltaY: WHEEL_THRESHOLD - 1 });
    expect(go).not.toHaveBeenCalled();
  });

  it('moves only once for a burst of wheel events', () => {
    const go = vi.fn();
    const { getByTestId } = render(<Harness go={go} section="runs" />);
    for (let i = 0; i < 10; i += 1) fireEvent.wheel(getByTestId('frame'), { deltaY: 200 });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('lets an inner list scroll first, and moves only once it is at its end', () => {
    const go = vi.fn();
    const { getByTestId } = render(<Harness go={go} section="runs" />);
    const inner = getByTestId('inner');
    scrollable(inner, 0, 1000, 300);
    fireEvent.wheel(inner, { deltaY: 200 });
    expect(go).not.toHaveBeenCalled();
    scrollable(inner, 700, 1000, 300);
    fireEvent.wheel(inner, { deltaY: 200 });
    expect(go).toHaveBeenCalledWith('/dashboard/insights');
  });

  it('never moves from inside a text field', () => {
    const go = vi.fn();
    const { getByTestId } = render(<Harness go={go} section="runs" />);
    const input = document.createElement('textarea');
    getByTestId('frame').append(input);
    fireEvent.wheel(input, { deltaY: 200 });
    expect(go).not.toHaveBeenCalled();
  });
});
