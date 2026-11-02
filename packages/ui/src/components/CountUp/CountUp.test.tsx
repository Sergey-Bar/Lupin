import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountUp, isCountable } from './CountUp.js';

describe('isCountable', () => {
  it('accepts a whole, non-negative number within range', () => {
    expect(isCountable(0)).toBe(true);
    expect(isCountable(42)).toBe(true);
    expect(isCountable(999_999_999)).toBe(true);
  });

  it.each([
    ['a decimal', 3.5],
    ['a negative', -1],
    ['past the range', 1_000_000_000],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['a string', '42'],
  ])('refuses %s', (_name, value) => {
    expect(isCountable(value as number | string)).toBe(false);
  });
});

describe('CountUp', () => {
  it('gives a screen reader the real number, and hides the animated copy', () => {
    const { container } = render(<CountUp value={128} />);
    expect(screen.getByText('128')).toHaveClass('sr-only');
    const animated = container.querySelector('.count-up');
    expect(animated).toHaveAttribute('aria-hidden', 'true');
    // The animated half carries no text of its own: it is generated content.
    expect(animated).toBeEmptyDOMElement();
  });

  it('counts from zero the first time and to the value it was given', () => {
    const { container } = render(<CountUp value={9} />);
    const style = (container.querySelector('.count-up') as HTMLElement).style;
    expect(style.getPropertyValue('--count-from')).toBe('0');
    expect(style.getPropertyValue('--count-to')).toBe('9');
  });

  it('counts from the previous value when it changes, and replays the animation', () => {
    const { container, rerender } = render(<CountUp value={10} />);
    const first = container.querySelector('.count-up') as HTMLElement;
    rerender(<CountUp value={25} />);
    const second = container.querySelector('.count-up') as HTMLElement;
    expect(second.style.getPropertyValue('--count-from')).toBe('10');
    expect(second.style.getPropertyValue('--count-to')).toBe('25');
    // A new element is what restarts a CSS animation; the same one would sit at its end state.
    expect(second).not.toBe(first);
  });

  it.each([['87%'], ['2.4s'], [3.5]])('draws %s as the plain text it already is', (value) => {
    const { container } = render(<CountUp value={value} />);
    expect(container).toHaveTextContent(String(value));
    expect(container.querySelector('.count-up')).toBeNull();
  });
});
