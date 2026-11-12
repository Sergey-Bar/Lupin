import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ShapeReading } from '@lupin/shared-contracts';
import { ZoomBar } from './ZoomBar.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');

const reading = (overrides: Partial<ShapeReading> = {}): ShapeReading => ({
  version: 'shape/1',
  shape: 'good',
  freshness: 'fresh',
  measuredAt: '2026-11-11T09:00:00.000Z',
  reason: 'Every signal was measured in the last 7 days and is fine.',
  signals: [],
  ...overrides,
});

describe('ZoomBar', () => {
  it('names every level with its shape in words, links up, and marks where you are', () => {
    render(
      <ZoomBar
        now={() => NOW}
        levels={[
          {
            label: 'Portfolio',
            href: '/dashboard/portfolio',
            reading: { status: 'ready', value: reading({ shape: 'bad', reason: 'Quiet is F.' }) },
          },
          {
            label: 'Shop',
            href: null,
            reading: { status: 'ready', value: reading() },
          },
        ]}
      />,
    );
    const zoom = screen.getByRole('navigation', { name: 'Zoom' });
    const levels = within(zoom).getAllByRole('listitem');
    expect(levels.map((level) => level.textContent)).toEqual(['PortfolioBad', '/ShopGood']);
    expect(within(zoom).getByRole('link', { name: 'Portfolio' })).toHaveAttribute(
      'href',
      '/dashboard/portfolio',
    );
    expect(within(zoom).getByText('Shop').closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByTestId('zoom-reason')).toHaveTextContent(
      'Every signal was measured in the last 7 days and is fine. Measured 3 hours ago.',
    );
  });

  it('says stale evidence is stale, and never-measured evidence was never measured', () => {
    const { rerender } = render(
      <ZoomBar
        now={() => NOW}
        levels={[
          {
            label: 'Shop',
            href: null,
            reading: {
              status: 'ready',
              value: reading({
                shape: 'caution',
                freshness: 'stale',
                measuredAt: '2026-10-30T12:00:00.000Z',
                reason: 'Last measured 12 days ago.',
              }),
            },
          },
        ]}
      />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Caution · stale');
    expect(screen.getByTestId('zoom-reason')).toHaveTextContent(
      'Stale: last measured 12 days ago.',
    );
    rerender(
      <ZoomBar
        now={() => NOW}
        levels={[
          {
            label: 'Shop',
            href: null,
            reading: {
              status: 'ready',
              value: reading({
                shape: 'unknown',
                freshness: 'never',
                measuredAt: null,
                reason: 'Nothing has been measured yet.',
              }),
            },
          },
        ]}
      />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Not measured');
    expect(screen.getByTestId('zoom-reason')).toHaveTextContent('Never measured.');
  });

  it('says a level is still being read, or could not be read', () => {
    render(
      <ZoomBar
        levels={[
          { label: 'Portfolio', href: '/dashboard/portfolio', reading: { status: 'loading' } },
          { label: 'Shop', href: null, reading: { status: 'error', message: 'HTTP 503' } },
        ]}
      />,
    );
    expect(screen.getAllByRole('listitem').map((level) => level.textContent)).toEqual([
      'PortfolioReading…',
      '/ShopUnreadable',
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('The shape could not be read: HTTP 503');
  });
});
