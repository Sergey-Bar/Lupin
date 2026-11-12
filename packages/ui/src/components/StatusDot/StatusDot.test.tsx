import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusDot } from './StatusDot.js';

describe('StatusDot', () => {
  it.each([
    ['good', 'bg-success'],
    ['warn', 'bg-warning'],
    ['bad', 'bg-danger'],
    ['info', 'bg-info'],
    ['unknown', 'ring-fg-muted'],
  ] as const)('paints %s from its status token', (status, tone) => {
    const { container } = render(<StatusDot status={status} />);
    expect(container.firstElementChild).toHaveClass(tone);
  });

  it.each([
    ['good', 'ring-success/20'],
    ['warn', 'ring-warning/20'],
    ['bad', 'ring-danger/20'],
    ['info', 'ring-info/20'],
  ] as const)(
    'sits %s in a soft halo of its own tone, so it reads as a mark, not a sticker',
    (status, halo) => {
      const { container } = render(<StatusDot status={status} />);
      expect(container.firstElementChild).toHaveClass('ring-3', halo);
    },
  );

  it('gives each verdict its own shape, so colour is never the only carrier', () => {
    const shape = (status: 'good' | 'warn' | 'bad') =>
      render(<StatusDot status={status} />).container.firstElementChild?.className;
    expect(shape('good')).toContain('rounded-full');
    expect(shape('warn')).toContain('rotate-45');
    expect(shape('bad')).toContain('rounded-xs');
    expect(shape('bad')).not.toContain('rounded-full');
  });

  it('is decorative when it has no label, because a word beside it says the same thing', () => {
    const { container } = render(<StatusDot status="bad" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is a named image when it stands alone, so colour is never the only carrier', () => {
    render(<StatusDot status="bad" label="Failing" />);
    expect(screen.getByRole('img', { name: 'Failing' })).toBeInTheDocument();
  });

  it('draws an unknown status hollow, so it reads as absent rather than as a fourth colour', () => {
    const { container } = render(<StatusDot status="unknown" />);
    expect(container.firstElementChild).toHaveClass('ring-1');
  });

  it('can pulse for a live state, and stops under reduced motion', () => {
    const { container } = render(<StatusDot status="info" live />);
    expect(container.firstElementChild).toHaveClass('animate-lupin-pulse');
    expect(container.firstElementChild).toHaveClass('motion-reduce:animate-none');
  });
});
