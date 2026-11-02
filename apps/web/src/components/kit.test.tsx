import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageBody, ScrollRegion } from './kit.js';

describe('ScrollRegion', () => {
  it('is a labelled region a keyboard can reach', () => {
    render(<ScrollRegion label="Artifact list">rows</ScrollRegion>);
    const region = screen.getByRole('region', { name: 'Artifact list' });
    // `tabIndex=0` is what lets a keyboard scroll it (axe `scrollable-region-focusable`).
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('scrolls only from lg, where the panels sit side by side', () => {
    render(<ScrollRegion label="Rows">rows</ScrollRegion>);
    const classes = screen.getByRole('region', { name: 'Rows' }).className.split(/\s+/u);
    // Below `lg` `<main>` is the one scroll container; a second one inside it traps touch scroll.
    expect(classes).toContain('lg:overflow-y-auto');
    expect(classes).toContain('lg:min-h-0');
    expect(classes).not.toContain('overflow-y-auto');
    expect(classes).not.toContain('min-h-0');
  });

  it('keeps a caller class beside its own', () => {
    render(
      <ScrollRegion label="Rows" className="gap-3">
        rows
      </ScrollRegion>,
    );
    expect(screen.getByRole('region', { name: 'Rows' })).toHaveClass('gap-3', 'rounded-md');
  });
});

describe('PageBody', () => {
  it('fills what the header leaves, as a region named for the page content', () => {
    render(<PageBody>body</PageBody>);
    const body = screen.getByRole('region', { name: 'Page content' });
    expect(body).toHaveClass('lg:flex-1', 'lg:overflow-y-auto');
    expect(body).toHaveTextContent('body');
  });

  it('takes a more specific label', () => {
    render(<PageBody label="Delivery sections">body</PageBody>);
    expect(screen.getByRole('region', { name: 'Delivery sections' })).toBeInTheDocument();
  });
});
