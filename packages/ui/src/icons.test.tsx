import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from './icons.js';

/**
 * An arrow that points along the reading line has to flip when the line runs right to left, or
 * "next" points at "previous". An arrow that points up does not, and flipping it would be wrong
 * in the other direction.
 */
describe('mirrored icons', () => {
  const svgOf = (element: React.ReactElement) => render(element).container.querySelector('svg')!;

  it('flips the icons that point along the reading line', () => {
    for (const Icon of [ArrowRight, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen]) {
      expect(svgOf(<Icon />)).toHaveClass('rtl:-scale-x-100');
    }
  });

  it("leaves the icons that do not, and keeps the caller's own classes and props", () => {
    expect(svgOf(<ArrowUp />)).not.toHaveClass('rtl:-scale-x-100');
    const svg = svgOf(<ChevronRight className="shrink-0" size={20} aria-hidden="true" />);
    expect(svg).toHaveClass('shrink-0');
    expect(svg).toHaveClass('rtl:-scale-x-100');
    expect(svg).toHaveAttribute('width', '20');
  });
});
