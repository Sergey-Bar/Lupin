import { BriefingSchema } from '@lupin/shared-contracts';
import { describe, expect, it } from 'vitest';
import { BRIEFING_VERSION, composeBriefing, type BriefingInput } from './briefing.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const PROJECT = '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11';

const busy = (overrides: Partial<BriefingInput> = {}): BriefingInput => ({
  scope: { kind: 'repository', projectId: PROJECT, name: 'Shop' },
  now: NOW,
  windowDays: 7,
  merged: { total: 14, ai: 9, highRisk: 2, unreviewedAi: 2, tampered: 1 },
  deployments: 3,
  pace: { changedLines: 4200, testsPerKloc: 1.5, debt: 1240, unmeasured: 300 },
  bottlenecks: [
    {
      projectId: PROJECT,
      projectName: 'Shop',
      sentence: 'Review is the bottleneck: 11 changes waiting over 48 hours.',
    },
  ],
  quality: { headline: 'Down 6 points since last week, mostly lower coverage.', tone: 'bad' },
  decisions: [
    {
      projectId: PROJECT,
      projectName: 'Shop',
      number: 12,
      title: 'Agent refactor',
      level: 'critical',
      score: 80,
    },
  ],
  ...overrides,
});

const ids = (input: BriefingInput) => composeBriefing(input).items.map((item) => item.id);

describe('composeBriefing', () => {
  it('says what shipped, what got riskier, what moved and what needs a decision, each cited', () => {
    const briefing = composeBriefing(busy());
    expect(BriefingSchema.safeParse(briefing).success).toBe(true);
    expect(briefing).toMatchObject({ version: BRIEFING_VERSION, shape: 'bad', windowDays: 7 });
    expect(briefing.items.map((item) => [item.id, item.tone, item.text])).toEqual([
      [
        'shape.pace',
        'caution',
        '4,200 lines changed, 1.5 new tests per 1,000 lines; 1,240 untested changed lines merged, 300 with coverage not measured.',
      ],
      [
        'shape.bottleneck-1',
        'caution',
        'Review is the bottleneck: 11 changes waiting over 48 hours.',
      ],
      ['shipped.merged', 'neutral', '14 pull requests merged, 9 AI-written.'],
      ['shipped.deployments', 'neutral', '3 deployments to production.'],
      ['riskier.high-risk', 'bad', '2 merged at high risk or above.'],
      ['riskier.unreviewed-ai', 'bad', '2 AI-written merged with no person approving.'],
      ['riskier.tampered', 'bad', '1 merged with changes that weakened its tests.'],
      ['quality.cockpit', 'bad', 'Down 6 points since last week, mostly lower coverage.'],
      [
        'decide.pr-0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11-12',
        'bad',
        '#12 Agent refactor: critical risk, 80 points, still open.',
      ],
    ]);
    expect(
      briefing.items.find((item) => item.id === 'decide.pr-0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11-12')
        ?.link,
    ).toBe(`/dashboard/prs/${PROJECT}/12`);
    // The pull-request list takes `?project=`, so a repository's lines open it narrowed to it.
    expect(briefing.items.find((item) => item.id === 'shipped.merged')?.link).toBe(
      `/dashboard/prs?project=${PROJECT}`,
    );
    expect(
      composeBriefing(busy({ scope: { kind: 'portfolio', projects: 2 } })).items.find(
        (item) => item.id === 'riskier.tampered',
      )?.link,
    ).toBe('/dashboard/prs');
    expect(briefing.headline).toBe(
      '14 pull requests merged, 9 AI-written; 2 merged at high risk or above; Review is the bottleneck: 11 changes waiting over 48 hours.',
    );
  });

  it('says once that nothing happened, invents nothing, and is not good', () => {
    const quiet = composeBriefing(
      busy({
        merged: { total: 0, ai: 0, highRisk: 0, unreviewedAi: 0, tampered: 0 },
        deployments: 0,
        pace: { changedLines: 0, testsPerKloc: null, debt: 0, unmeasured: 0 },
        bottlenecks: [],
        quality: null,
        decisions: [],
      }),
    );
    expect(quiet.items).toEqual([
      {
        id: 'shape.quiet',
        section: 'shape',
        tone: 'neutral',
        text: 'Nothing happened in the last 7 days.',
        evidence: ['window:7d'],
        link: null,
      },
    ]);
    expect(quiet.shape).toBe('unknown');
    expect(quiet.headline).toBe('Nothing happened in the last 7 days.');
  });

  it('says nothing merged is known when the sync is off, rather than "0 merged"', () => {
    const briefing = composeBriefing(busy({ merged: null, pace: null, deployments: null }));
    expect(briefing.items.find((item) => item.section === 'shipped')).toMatchObject({
      id: 'shipped.not-synced',
      text: 'Nothing merged is known: turn on delivery sync.',
    });
    expect(ids(busy({ merged: null })).some((id) => id.startsWith('riskier.'))).toBe(false);
  });

  it('names the repository in a portfolio briefing, and caps the lists', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      projectId: PROJECT,
      projectName: 'Shop',
      number: index + 1,
      title: `Change ${String(index + 1)}`,
      level: 'high' as const,
      score: 50,
    }));
    const briefing = composeBriefing(
      busy({
        scope: { kind: 'portfolio', projects: 4 },
        decisions: many,
        bottlenecks: Array.from({ length: 5 }, () => busy().bottlenecks[0]!),
      }),
    );
    const decide = briefing.items.filter((item) => item.section === 'decide');
    expect(decide).toHaveLength(5);
    expect(decide[0]).toMatchObject({
      tone: 'caution',
      text: 'Shop #1 Change 1: high risk, 50 points, still open.',
    });
    expect(briefing.items.filter((item) => item.id.startsWith('shape.bottleneck'))).toHaveLength(3);
    expect(briefing.items.find((item) => item.id === 'shape.bottleneck-1')?.text).toBe(
      'Shop: Review is the bottleneck: 11 changes waiting over 48 hours.',
    );
  });

  it('is good when every measured line is good, and says pace holds with no debt', () => {
    const calm = composeBriefing(
      busy({
        merged: { total: 3, ai: 0, highRisk: 0, unreviewedAi: 0, tampered: 0 },
        pace: { changedLines: 300, testsPerKloc: 10, debt: 0, unmeasured: 0 },
        bottlenecks: [],
        quality: { headline: 'Up 2 points since last week.', tone: 'good' },
        decisions: [],
      }),
    );
    expect(calm.shape).toBe('good');
    expect(calm.items.find((item) => item.id === 'shape.pace')).toMatchObject({ tone: 'good' });
    expect(calm.headline).toBe('3 pull requests merged, 0 AI-written.');
  });

  it('says new tests were not measured, and a cockpit that cannot compare is caution', () => {
    const briefing = composeBriefing(
      busy({
        pace: { changedLines: 100, testsPerKloc: null, debt: 0, unmeasured: 100 },
        quality: { headline: 'Not comparable.', tone: 'caution' },
      }),
    );
    expect(briefing.items.find((item) => item.id === 'shape.pace')?.text).toBe(
      '100 lines changed, new tests not measured; 0 untested changed lines merged, 100 with coverage not measured.',
    );
    expect(briefing.items.find((item) => item.id === 'quality.cockpit')?.tone).toBe('caution');
  });
});
