import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Button, ButtonLink } from '@lupin/ui';
import { expectOnePrimary } from './test-utils.js';

/**
 * The one-primary helper has to see the real button, or every page test that asks for "at
 * most one" passes by counting nothing. It did exactly that once: the primary's class changed
 * and the helper went on looking for the old one, with every page test still green.
 */
describe('expectOnePrimary', () => {
  it('finds the real primary Button and ButtonLink', () => {
    const { container } = render(
      <>
        <Button>Retry</Button>
        <Button variant="secondary">Open</Button>
      </>,
    );
    expect(expectOnePrimary(container)).toEqual(['Retry']);
    const link = render(<ButtonLink href="/x">Go</ButtonLink>);
    expect(expectOnePrimary(link.container)).toEqual(['Go']);
  });

  it('refuses a second primary on one screen', () => {
    const { container } = render(
      <>
        <Button>One</Button>
        <Button>Two</Button>
      </>,
    );
    expect(() => expectOnePrimary(container)).toThrow(/at most one solid primary/u);
  });
});
