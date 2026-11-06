import { render, screen } from '@testing-library/react';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders badge', () => {
    render(<Badge data-testid="badge">Badge</Badge>);
    expect(screen.getByTestId('badge')).toBeInTheDocument();
  });
  it('renders variant', () => {
    render(
      <Badge data-testid="badge" variant="outline">
        Badge
      </Badge>,
    );
    expect(screen.getByTestId('badge')).toHaveClass('text-fg-muted');
  });
  it('applies custom classes', () => {
    render(
      <Badge data-testid="badge" className="custom">
        Badge
      </Badge>,
    );
    expect(screen.getByTestId('badge')).toHaveClass('custom');
  });
});

/**
 * Monochrome first. A status is a dot and a word: the word is in the foreground and only the
 * dot carries the run-state colour, so a screen of runs is not a field of red and green pills.
 */
describe('Badge is monochrome', () => {
  it.each([
    ['success', 'before:bg-success'],
    ['danger', 'before:bg-danger'],
    ['warning', 'before:bg-warning'],
    ['default', 'before:bg-accent'],
  ] as const)('draws %s as a %s dot beside a foreground word', (variant, dot) => {
    render(
      <Badge data-testid="badge" variant={variant}>
        word
      </Badge>,
    );
    const badge = screen.getByTestId('badge');
    expect(badge).toHaveClass(dot, 'text-fg');
    expect(badge.className).not.toMatch(/(?<![:\w-])bg-(success|danger|warning|accent)\b/);
    expect(badge.className).not.toMatch(/\btext-on-fill\b/);
  });

  it('draws no pill: no border and no fill on any variant', () => {
    for (const variant of [
      'default',
      'secondary',
      'success',
      'danger',
      'warning',
      'outline',
    ] as const) {
      const { unmount } = render(
        <Badge data-testid="badge" variant={variant}>
          word
        </Badge>,
      );
      const classes = screen.getByTestId('badge').className;
      expect(classes, variant).not.toMatch(/(?<![:\w-])(border|rounded-full)\b/);
      expect(classes, variant).not.toMatch(/(?<![:\w-])bg-/);
      unmount();
    }
  });
});
