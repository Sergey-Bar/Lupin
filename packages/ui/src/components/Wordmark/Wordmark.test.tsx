import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Wordmark } from './Wordmark.js';

describe('Wordmark', () => {
  it('is a named image reading "Lupin" when it stands alone', () => {
    render(<Wordmark />);
    expect(screen.getByRole('img', { name: 'Lupin' })).toHaveTextContent('Lupin.');
  });

  it('is hidden from assistive technology when decorative, because a heading names the screen', () => {
    const { container } = render(<Wordmark decorative />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('draws the name in the foreground token and the dot in the accent', () => {
    const { container } = render(<Wordmark />);
    expect(container.firstElementChild).toHaveClass('text-fg', 'font-semibold', 'tracking-tight');
    expect(container.querySelector('[data-wordmark-dot]')).toHaveClass('text-accent');
  });

  it.each([
    ['sm', 'text-base'],
    ['md', 'text-lg'],
    ['lg', 'text-3xl'],
  ] as const)('sets size %s from the type scale', (size, cls) => {
    const { container } = render(<Wordmark size={size} />);
    expect(container.firstElementChild).toHaveClass(cls);
  });

  it('defaults to the chrome size', () => {
    const { container } = render(<Wordmark />);
    expect(container.firstElementChild).toHaveClass('text-lg');
  });
});
