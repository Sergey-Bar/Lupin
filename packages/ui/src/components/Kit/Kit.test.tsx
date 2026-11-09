import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoBlockingAxeViolations } from '../../test/axe.js';
import { ActionCard, Hero, Row, Surface } from './Kit.js';

describe('Surface', () => {
  it.each([
    [1, 'bg-elevation-1'],
    [2, 'bg-elevation-2'],
    [3, 'bg-elevation-3'],
  ] as const)('draws elevation %s on its own plane token', (level, token) => {
    render(<Surface level={level}>content</Surface>);
    expect(screen.getByText('content')).toHaveClass(token);
  });
});

describe('Hero', () => {
  it('says the verdict in the display face, on its glow, with one reason', () => {
    render(<Hero verdict="no-go" word="No-go" reason="Pass rate 73.5% is below the 80% floor" />);
    const hero = screen.getByRole('region', { name: 'No-go' });
    expect(hero).toHaveAttribute('data-verdict', 'no-go');
    expect(hero).toHaveClass('bg-glow-no-go');
    expect(within(hero).getByRole('heading', { level: 1, name: 'No-go' })).toHaveClass(
      'font-display',
    );
    expect(hero).toHaveTextContent('Pass rate 73.5% is below the 80% floor');
  });

  it('arrives on the expressive tier', () => {
    render(<Hero verdict="go" word="Ready" reason="All gates pass" />);
    expect(screen.getByRole('region', { name: 'Ready' })).toHaveClass('animate-reveal');
  });
});

describe('Row', () => {
  const cards = ['one', 'two', 'three'].map((name) => <div key={name}>{name}</div>);

  it('is a labelled list a reader can scroll sideways', () => {
    render(<Row title="Broke since yesterday">{cards}</Row>);
    const row = screen.getByRole('list', { name: 'Broke since yesterday' });
    expect(within(row).getAllByRole('listitem')).toHaveLength(3);
    expect(row).toHaveClass('overflow-x-auto');
  });

  it('moves one card at a time with the arrow keys, never past the ends', () => {
    render(<Row title="Flaky">{cards}</Row>);
    const items = within(screen.getByRole('list', { name: 'Flaky' })).getAllByRole('listitem');
    items[0]?.focus();
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'ArrowLeft' });
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('draws nothing for an empty row, rather than a heading over nothing', () => {
    const { container } = render(<Row title="Empty">{[]}</Row>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ActionCard', () => {
  it('carries the verdict as a word beside its colour, one fact, and one button', () => {
    const act = vi.fn();
    render(
      <ActionCard
        tone="bad"
        title="checkout is failing"
        fact="2 tests"
        action="Retry"
        onAct={act}
      />,
    );
    const card = screen.getByRole('article', { name: 'checkout is failing' });
    expect(card).toHaveTextContent('Needs you');
    expect(card).toHaveTextContent('2 tests');
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(act).toHaveBeenCalledOnce();
  });

  it('has no serious or critical axe violations, with a hero, a row and cards', async () => {
    const { container } = render(
      <>
        <Hero verdict="caution" word="Caution" reason="One gate warns" />
        <Row title="Waiting on you">
          {[
            <ActionCard
              key="a"
              tone="warn"
              title="Review"
              fact="8 tests"
              action="Open"
              onAct={vi.fn()}
            />,
          ]}
        </Row>
      </>,
    );
    await expectNoBlockingAxeViolations(container);
  });
});
