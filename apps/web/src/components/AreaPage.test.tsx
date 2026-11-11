import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { commandStore } from '../hooks/useCommandActions.js';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Hero } from '@lupin/ui';
import { AreaPage, type AreaItem } from './AreaPage.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';

const item = (id: string, overrides: Partial<AreaItem> = {}): AreaItem => ({
  id,
  title: `item ${id}`,
  detail: 'why it matters',
  tone: 'bad',
  action: { label: 'Open', to: `/x/${id}` },
  ...overrides,
});

function show(items: AreaItem[], extra: Partial<React.ComponentProps<typeof AreaPage>> = {}) {
  const navigate = vi.fn();
  const view = render(
    <AreaPage
      title="Tests"
      verdict="Two tests need a decision."
      items={items}
      navigate={navigate}
      {...extra}
    />,
  );
  return { navigate, ...view };
}

describe('AreaPage', () => {
  it('says the verdict in one sentence under the title', () => {
    show([item('a')]);
    expect(screen.getByRole('heading', { level: 1, name: 'Tests' })).toBeInTheDocument();
    expect(screen.getByTestId('area-verdict')).toHaveTextContent('Two tests need a decision.');
  });

  it('draws no "all clear" card under a hero, which has already said it at display size', () => {
    show([], { hero: <section aria-label="Green">Every branch is green.</section> });
    expect(screen.queryByTestId('area-clear')).toBeNull();
  });

  it('shows the main content open when the page is a list, with no fold to find it behind', () => {
    show([item('a')], {
      details: <p>the run table</p>,
      detailsTitle: 'All runs',
      detailsOpen: true,
    });
    expect(screen.queryByTestId('area-details')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'All runs' })).toBeInTheDocument();
    expect(screen.getByText('the run table')).toBeVisible();
  });

  it('keeps one order on every area page: the band, the list, then Details', () => {
    show([item('a')], {
      hero: <section aria-label="Failing">Two tests need a decision.</section>,
      details: <p>numbers</p>,
    });
    const band = screen.getByRole('region', { name: 'Failing' });
    const list = screen.getByRole('list', { name: 'Tests: what to do' });
    const details = screen.getByTestId('area-details');
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(band, list) && follows(list, details)).toBe(true);
    // Siblings in one column, so nothing is drawn beside the band or between them.
    expect(band.parentElement).toBe(list.parentElement);
    expect(list.parentElement).toBe(details.parentElement);
  });

  it('lets a hero say the verdict once, rather than again in a line under it', () => {
    show([item('a')], { hero: <section aria-label="Failing">Two tests need a decision.</section> });
    expect(screen.getByRole('region', { name: 'Failing' })).toBeInTheDocument();
    expect(screen.queryByTestId('area-verdict')).toBeNull();
  });

  it('shows at most three items, and folds the rest behind one quiet line', () => {
    show(['a', 'b', 'c', 'd', 'e'].map((id) => item(id)));
    expect(screen.getAllByTestId(/^area-item-/u)).toHaveLength(3);
    const rest = screen.getByTestId('area-rest');
    expect(rest.tagName).toBe('DETAILS');
    expect(rest).not.toHaveAttribute('open');
    expect(rest).toHaveTextContent('2 more when you are ready');
  });

  it('has exactly one primary button on the screen, on the first item', () => {
    const { container } = show(['a', 'b', 'c'].map((id) => item(id)));
    expect(container.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    expect(
      within(screen.getByTestId('area-item-a')).getByRole('button', { name: 'Open' }),
    ).toHaveAttribute('data-primary', 'true');
  });

  it('puts a word beside every dot, so colour is never the only signal', () => {
    show([item('a', { tone: 'bad' }), item('b', { tone: 'warn' })]);
    expect(screen.getByTestId('area-item-a')).toHaveTextContent('Needs you');
    expect(screen.getByTestId('area-item-b')).toHaveTextContent('Worth a look');
  });

  it('marks what is new since the last visit', () => {
    localStorage.setItem('lupin-area-tests', '2026-11-01T00:00:00.000Z');
    show([
      item('a', { at: '2026-11-08T00:00:00.000Z' }),
      item('b', { at: '2026-10-01T00:00:00.000Z' }),
    ]);
    expect(within(screen.getByTestId('area-item-a')).getByText('new')).toBeInTheDocument();
    expect(within(screen.getByTestId('area-item-b')).queryByText('new')).toBeNull();
    localStorage.clear();
  });

  it('runs an automatic action, shows progress, and lets the item leave when it is done', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((done) => (finish = done)));
    show([item('a', { action: { label: 'Quarantine', run } })]);
    await user.click(screen.getByRole('button', { name: 'Quarantine' }));
    expect(screen.getByRole('button', { name: 'Quarantining' })).toBeDisabled();
    finish();
    expect(await screen.findByRole('status')).toHaveTextContent('Done: item a');
  });

  it('fades a finished item out with the exit motion, then removes it', async () => {
    const user = userEvent.setup();
    show([item('a', { action: { label: 'Quarantine', run: async () => undefined } })]);
    await user.click(screen.getByRole('button', { name: 'Quarantine' }));
    const leaving = await screen.findByTestId('area-item-a');
    expect(leaving).toHaveAttribute('data-leaving', 'true');
    expect(leaving).toHaveClass('animate-fade-out');
    await waitFor(() => expect(screen.queryByTestId('area-item-a')).toBeNull());
  });
  it('keeps the item and says why when the automatic action is refused', async () => {
    const user = userEvent.setup();
    show([
      item('a', {
        action: { label: 'Quarantine', run: async () => Promise.reject(new Error('Forbidden')) },
      }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Quarantine' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.getByTestId('area-item-a')).toBeInTheDocument();
  });

  it('navigates for a plain action', async () => {
    const user = userEvent.setup();
    const { navigate } = show([item('a')]);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(navigate).toHaveBeenCalledWith('/x/a');
  });

  it('says all clear when there is nothing to do, and keeps the details reachable', () => {
    show([], { details: <p>raw numbers</p>, clear: 'Every test is steady.' });
    expect(screen.getByTestId('area-clear')).toHaveTextContent('Every test is steady.');
    const details = screen.getByTestId('area-details');
    expect(details.tagName).toBe('DETAILS');
    expect(details).toHaveTextContent('raw numbers');
  });

  it('says the busy word it was given, or makes one from a verb that does not end in e', async () => {
    const user = userEvent.setup();
    const pending = () => new Promise<void>(() => undefined);
    show([
      item('a', { action: { label: 'Retry now', busyLabel: 'Retrying', run: pending } }),
      item('b', { action: { label: 'Mark done', run: pending } }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Retry now' }));
    await user.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(screen.getByRole('button', { name: 'Retrying' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Marking' })).toBeDisabled();
  });

  it('takes the action of a folded item too, and announces it', async () => {
    const user = userEvent.setup();
    const run = vi.fn(async () => undefined);
    show([item('a'), item('b'), item('c'), item('d', { action: { label: 'Quarantine', run } })]);
    const folded = screen.getByTestId('area-folded-d');
    await user.click(within(folded).getByRole('button', { name: 'Quarantine' }));
    expect(run).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent('Done: item d');
    await waitFor(() => expect(screen.queryByTestId('area-folded-d')).toBeNull());
  });

  it('removes a finished item at once when Lupin’s Motion setting is reduced', async () => {
    const user = userEvent.setup();
    document.documentElement.dataset['motion'] = 'reduced';
    try {
      show([item('a', { action: { label: 'Quarantine', run: async () => undefined } })]);
      await user.click(screen.getByRole('button', { name: 'Quarantine' }));
      await screen.findByRole('status');
      expect(screen.queryByTestId('area-item-a')).toBeNull();
    } finally {
      delete document.documentElement.dataset['motion'];
    }
  });

  it('removes a finished item at once when the system asks for reduced motion', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }) as MediaQueryList),
    );
    try {
      show([item('a', { action: { label: 'Quarantine', run: async () => undefined } })]);
      await user.click(screen.getByRole('button', { name: 'Quarantine' }));
      await screen.findByRole('status');
      expect(screen.queryByTestId('area-item-a')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('marks a folded item new since the last visit as well', () => {
    localStorage.setItem('lupin-area-tests', '2026-11-01T00:00:00.000Z');
    show([item('a'), item('b'), item('c'), item('d', { at: '2026-11-08T00:00:00.000Z' })]);
    expect(within(screen.getByTestId('area-folded-d')).getByText('new')).toBeInTheDocument();
    localStorage.clear();
  });

  it('lets focus mode keep the verdict and the top items, and put the rest away', () => {
    show(
      ['a', 'b', 'c', 'd'].map((id) => item(id)),
      { details: <p>numbers</p> },
    );
    expect(screen.getByTestId('area-item-a').closest('[data-chrome="secondary"]')).toBeNull();
    expect(screen.getByTestId('area-verdict').closest('[data-chrome="secondary"]')).toBeNull();
    expect(screen.getByTestId('area-rest')).toHaveAttribute('data-chrome', 'secondary');
    expect(screen.getByTestId('area-details')).toHaveAttribute('data-chrome', 'secondary');
  });

  it('does not say the first item twice: a verdict that repeats it becomes a count', () => {
    show([item('a', { title: 'Pass rate is low' }), item('b')], { verdict: 'Pass rate is low' });
    expect(screen.getByTestId('area-verdict')).toHaveTextContent('2 things need you.');
  });

  it('counts only what needs you, not the items given for context', () => {
    show([item('a', { title: 'Same' }), item('b', { tone: 'warn' }), item('c', { tone: 'info' })], {
      verdict: 'Same',
    });
    expect(screen.getByTestId('area-verdict')).toHaveTextContent('2 things need you.');
  });

  it('lets a long title wrap rather than cut it off mid-word', () => {
    show([item('a', { title: 'A very long title' }), item('b')]);
    const title = screen.getByText('A very long title');
    expect(title.className).not.toMatch(/(^|\s)truncate(\s|$)/u);
    expect(title.className).toMatch(/line-clamp-2/u);
  });

  it('offers each action Lupin can take from the command palette too', async () => {
    const run = vi.fn(async () => undefined);
    show([item('a', { title: 'login is flaky', action: { label: 'Quarantine', run } })]);
    const action = commandStore.getActions().find((entry) => entry.id === 'area-act-a');
    expect(action?.label).toBe('Quarantine: login is flaky');
    await act(async () => action?.onSelect());
    expect(run).toHaveBeenCalledOnce();
  });

  it('names the A shortcut in the tooltip, not as a badge inside the button', () => {
    show([item('a'), item('b')]);
    const primary = within(screen.getByTestId('area-item-a')).getByRole('button', { name: 'Open' });
    expect(primary).toHaveAttribute('aria-keyshortcuts', 'a');
    expect(primary).toHaveAttribute('title', 'Open (A)');
    expect(primary.querySelector('kbd')).toBeNull();
    const other = within(screen.getByTestId('area-item-b')).getByRole('button', { name: 'Open' });
    expect(other).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('puts the first thing to do in the status band, so the page has one focal point', async () => {
    const user = userEvent.setup();
    const { navigate } = show([item('a'), item('b')], {
      hero: <Hero headingLevel={2} verdict="no-go" word="Failing" reason="One branch needs you." />,
    });
    const band = screen.getByRole('region', { name: 'Failing' });
    // The band says what to fix and offers the one primary button for it; its own count
    // stays, on the detail line.
    expect(within(band).getByText('item a')).toBeInTheDocument();
    expect(band).toHaveTextContent('why it matters · One branch needs you.');
    const primary = within(band).getByRole('button', { name: 'Open' });
    expect(primary).toHaveAttribute('data-primary', 'true');
    // The list starts at the second item, quietly, so nothing is said twice.
    expect(screen.queryByTestId('area-item-a')).toBeNull();
    const second = within(screen.getByTestId('area-item-b')).getByRole('button', { name: 'Open' });
    expect(second).toHaveAttribute('data-primary', 'false');
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    await user.click(primary);
    expect(navigate).toHaveBeenCalledWith('/x/a');
  });

  it('runs the band’s action, says it is done, and hands the band to the next item', async () => {
    const user = userEvent.setup();
    const run = vi.fn(async () => undefined);
    show([item('a', { action: { label: 'Retry', run } }), item('b')], {
      hero: <Hero headingLevel={2} verdict="no-go" word="Failing" reason="Two need you." />,
    });
    const band = screen.getByRole('region', { name: 'Failing' });
    await user.click(within(band).getByRole('button', { name: 'Retry' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Done: item a');
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Failing' })).getByText('item b'),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole('region', { name: 'Failing' })).getByRole('button', {
        name: 'Open',
      }),
    ).toHaveAttribute('data-primary', 'true');
  });

  it('keeps the band’s own reason when nothing needs you', () => {
    show([], {
      hero: <Hero headingLevel={2} verdict="go" word="Green" reason="Every branch passed." />,
    });
    const band = screen.getByRole('region', { name: 'Green' });
    expect(within(band).getByText('Every branch passed.')).toBeInTheDocument();
    expect(within(band).queryByRole('button')).toBeNull();
  });

  it('draws every item as the same quiet card the band and the panels are', () => {
    show([item('a'), item('b')]);
    expect(screen.getByTestId('area-item-a')).toHaveClass(
      'rounded-lg',
      'border',
      'border-border',
      'bg-surface',
    );
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = show(
      ['a', 'b', 'c', 'd'].map((id) => item(id)),
      { details: <p>numbers</p> },
    );
    await expectNoBlockingAxeViolations(container);
  });
});
