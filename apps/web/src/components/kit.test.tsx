import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Kpi, PageBody, PageHeader, Panel, ScrollRegion } from './kit.js';

/**
 * Big type, lots of air, less chrome. A page leads with a display-size title; a figure is a
 * number on the page rather than a number in a box; a panel is grouped by its plane step and
 * its spacing, with no outline drawn round it.
 */
describe('the flat page', () => {
  it('titles a page at display size from lg up', () => {
    render(<PageHeader title="Runs" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('lg:text-5xl');
  });

  it('draws a figure with no box round it', () => {
    render(<Kpi data-testid="kpi" label="Total runs" value="5" />);
    const classes = screen.getByTestId('kpi').className;
    expect(classes).not.toMatch(/(?<![:\w-])(border|bg-surface)\b/);
  });

  it('separates a panel by its plane step, not by an outline', () => {
    render(<Panel title="All runs">rows</Panel>);
    const panel = screen.getByRole('region', { name: 'All runs' });
    expect(panel).toHaveClass('bg-surface');
    expect(panel.className).not.toMatch(/(?<![:\w-])border\b/);
  });
});

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
