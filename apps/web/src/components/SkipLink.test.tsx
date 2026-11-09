import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SkipLink } from './SkipLink.js';

describe('SkipLink', () => {
  it('is the first Tab stop, hidden until focused, and moves focus past the chrome', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink />
        <nav>
          <a href="/x">Chrome</a>
        </nav>
        <main id="main" tabIndex={-1}>
          content
        </main>
      </>,
    );
    await user.tab();
    const link = screen.getByRole('link', { name: 'Skip to content' });
    expect(link).toHaveFocus();
    expect(link).toHaveClass('sr-only', 'focus:not-sr-only');
    await user.click(link);
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
