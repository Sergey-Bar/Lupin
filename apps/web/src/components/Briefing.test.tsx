import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Briefing, BriefingResponse } from '@lupin/shared-contracts';
import type { HealthClient } from '../lib/health-client.js';
import { expectOnePrimary, makeHealthDouble } from '../test-utils.js';
import { BriefingCard, BriefingPage, briefingPath, worstItems } from './Briefing.js';

const briefing = (overrides: Partial<Briefing> = {}): Briefing => ({
  version: 'briefing/1',
  scope: { kind: 'repository', projectId: 'p-1', name: 'Shop' },
  windowDays: 7,
  generatedAt: '2026-11-11T12:00:00.000Z',
  shape: 'bad',
  headline: '3 pull requests merged, 2 AI-written; 1 merged at high risk or above.',
  items: [
    {
      id: 'shipped.merged',
      section: 'shipped',
      tone: 'neutral',
      text: '3 pull requests merged, 2 AI-written.',
      evidence: ['pull-requests:merged:project:p-1:7d'],
      link: '/dashboard/prs?project=p-1',
    },
    {
      id: 'shape.bottleneck-1',
      section: 'shape',
      tone: 'caution',
      text: 'Review is the bottleneck: 2 changes waiting over 48 hours.',
      evidence: ['phases:project:p-1'],
      link: '/dashboard/repo/p-1/overview',
    },
    {
      id: 'riskier.high-risk',
      section: 'riskier',
      tone: 'bad',
      text: '1 merged at high risk or above.',
      evidence: ['risk-assessments:project:p-1:7d'],
      link: '/dashboard/prs?project=p-1',
    },
    {
      id: 'quality.cockpit',
      section: 'quality',
      tone: 'good',
      text: 'Up 2 points since last week.',
      evidence: ['cockpit:project:p-1:7d'],
      link: null,
    },
  ],
  ...overrides,
});

const response = (narration: BriefingResponse['narration'] = null): BriefingResponse => ({
  briefing: briefing(),
  narration,
});

describe('worstItems and briefingPath', () => {
  it('puts bad before caution before good before a plain note, keeping order within a tone', () => {
    expect(worstItems(briefing(), 4).map((item) => item.id)).toEqual([
      'riskier.high-risk',
      'shape.bottleneck-1',
      'quality.cockpit',
      'shipped.merged',
    ]);
    expect(briefingPath(undefined)).toBe('/dashboard/briefing');
    expect(briefingPath('a b')).toBe('/dashboard/briefing?project=a%20b');
  });
});

describe('BriefingCard', () => {
  it('leads with the shape in words and the headline, then the three worst lines, linked', () => {
    render(<BriefingCard read={{ status: 'ready', value: response() }} projectId="p-1" />);
    const card = screen.getByTestId('briefing-card');
    expect(within(card).getByTestId('briefing-shape')).toHaveTextContent('Bad');
    const lines = within(within(card).getByRole('list', { name: 'The worst of it' })).getAllByRole(
      'listitem',
    );
    expect(lines.map((line) => line.textContent)).toEqual([
      'Bad1 merged at high risk or above.',
      'CautionReview is the bottleneck: 2 changes waiting over 48 hours.',
      'GoodUp 2 points since last week.',
    ]);
    expect(within(card).getByRole('link', { name: 'Open the briefing' })).toHaveAttribute(
      'href',
      '/dashboard/briefing?project=p-1',
    );
    expect(
      within(card).getByRole('link', { name: '1 merged at high risk or above.' }),
    ).toHaveAttribute('href', '/dashboard/prs?project=p-1');
  });

  it('says it could not read the briefing, rather than showing an empty card', () => {
    render(<BriefingCard read={{ status: 'error', message: 'HTTP 500' }} projectId={undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The briefing could not be read: HTTP 500');
  });
});

type GetBriefing = HealthClient['getBriefing'];

/** `null` is the portfolio: a default parameter would swallow an explicit `undefined`. */
function page(getBriefing: GetBriefing, projectId: string | null = 'p-1') {
  const spy = vi.fn<GetBriefing>(getBriefing);
  const view = render(
    <BriefingPage
      health={makeHealthDouble('viewer', { getBriefing: spy })}
      projectId={projectId ?? undefined}
    />,
  );
  return { spy, view };
}

const narrated =
  (narration: BriefingResponse['narration']): GetBriefing =>
  async (_project, options) =>
    options?.narrate === true ? response(narration) : response();

describe('BriefingPage', () => {
  it('draws each section that has a line, with its evidence, and no solid primary', async () => {
    const { spy, view } = page(async () => response());
    expect(await screen.findByTestId('briefing-headline')).toHaveTextContent(
      '3 pull requests merged, 2 AI-written; 1 merged at high risk or above.',
    );
    expect(spy).toHaveBeenCalledWith('p-1', { days: 7 });
    expect(screen.getByText('Shop')).toBeInTheDocument();
    // Sections in the briefing's order; "Needs a decision" has no line, so it is not drawn.
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['In short', 'Shape', 'Shipped', 'Riskier', 'Quality']);
    const shipped = screen.getByTestId('briefing-item-shipped.merged');
    expect(within(shipped).getByText('pull-requests:merged:project:p-1:7d')).toBeInTheDocument();
    expect(expectOnePrimary(view.container)).toEqual([]);
  });

  it('reads the portfolio with no project, and the window the reader picks', async () => {
    const { spy } = page(
      async () => ({
        briefing: briefing({ scope: { kind: 'portfolio', projects: 4 } }),
        narration: null,
      }),
      null,
    );
    expect(await screen.findByText('Every repository (4)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(null, { days: 30 }));
  });

  it('asks for a wording only when told to, and shows it beside the lines it cites', async () => {
    const { spy } = page(
      narrated({
        status: 'accepted',
        model: 'llama3',
        narration: {
          sentences: [
            { text: 'One risky change merged.', cites: ['riskier.high-risk', 'shipped.merged'] },
          ],
        },
      }),
    );
    await screen.findByTestId('briefing-headline');
    expect(screen.queryByTestId('briefing-narration')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Word it for me' }));
    const narration = await screen.findByTestId('briefing-narration');
    expect(narration).toHaveTextContent('One risky change merged. (Riskier, Shipped)');
    expect(narration).toHaveTextContent('Worded by llama3 from the lines below');
    expect(spy).toHaveBeenLastCalledWith('p-1', { days: 7, narrate: true });
  });

  it('says a wording was thrown away and why, and keeps the lines', async () => {
    page(narrated({ status: 'rejected', model: 'm', reason: 'Sentence 1 uses 9.' }));
    await screen.findByTestId('briefing-headline');
    fireEvent.click(screen.getByRole('button', { name: 'Word it for me' }));
    expect(await screen.findByTestId('briefing-narration')).toHaveTextContent(
      'The model’s wording was thrown away: Sentence 1 uses 9. The lines below stand as written.',
    );
    expect(screen.getByTestId('briefing-item-riskier.high-risk')).toBeInTheDocument();
  });

  it('turns a failed wording request into a plain sentence, not a broken page', async () => {
    page(async (_project, options) => {
      if (options?.narrate === true) throw new Error('HTTP 502');
      return response();
    });
    await screen.findByTestId('briefing-headline');
    fireEvent.click(screen.getByRole('button', { name: 'Word it for me' }));
    const narration = await screen.findByTestId('briefing-narration');
    expect(narration.textContent).not.toContain('HTTP 502');
    expect(screen.getByTestId('briefing-item-shipped.merged')).toBeInTheDocument();
  });

  it('says it could not read the briefing', async () => {
    page(async () => Promise.reject(new Error('No project p-1')));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The briefing could not be read: No project p-1',
    );
  });
});
