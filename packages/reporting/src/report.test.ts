import { describe, expect, it } from 'vitest';
import { composeBriefing } from './briefing.js';
import {
  composeReport,
  MAX_BRIEFING_LINES,
  renderPlain,
  renderSlack,
  renderTeams,
  renderTelegram,
  reportBriefingOf,
  type ReportInput,
} from './report.js';

const BASE: ReportInput = {
  title: 'Weekly quality report',
  runs: 42,
  passRate: 97.14,
  attention: [],
  digest: [],
  link: 'https://lupin.local:8443/dashboard/now',
};

describe('composeReport', () => {
  it('is green with nothing to report, and says what ran', () => {
    const model = composeReport(BASE);
    expect(model).toMatchObject({
      status: 'good',
      emoji: '🟢',
      sentence: '97.1% passed across 42 runs.',
      items: [],
      more: 0,
    });
  });

  it('puts the worst first, keeps three, and counts the rest', () => {
    const model = composeReport({
      ...BASE,
      digest: [
        { kind: 'pass-rate', tone: 'good', text: 'Pass rate +2.0 pts' },
        { kind: 'new-flaky', tone: 'bad', text: '2 new flaky tests' },
      ],
      attention: [
        { severity: 'caution', text: 'checkout-api grade fell to C' },
        { severity: 'bad', text: 'Run #812 failed: 3 tests' },
      ],
    });
    expect(model.status).toBe('bad');
    expect(model.items.map((item) => item.text)).toEqual([
      'Run #812 failed: 3 tests',
      '2 new flaky tests',
      'checkout-api grade fell to C',
    ]);
    expect(model.more).toBe(1);
  });

  it('is amber for bad news that needs no one right now, and green for neutral news', () => {
    const model = composeReport({
      ...BASE,
      digest: [{ kind: 'coverage', tone: 'bad', text: 'Coverage -1.2 pts' }],
    });
    expect(model.status).toBe('caution');
    const quiet = composeReport({
      ...BASE,
      digest: [
        { kind: 'pass-rate', tone: 'good', text: 'Pass rate +1.0 pts' },
        { kind: 'runs', tone: 'neutral', text: '42 runs, up from 30' },
      ],
    });
    expect(quiet.status).toBe('good');
    // Neutral news sits after warnings and before good news, with its own plain bullet.
    expect(quiet.items.map((item) => item.tone)).toEqual(['neutral', 'good']);
    expect(renderPlain(quiet)).toContain('• 42 runs, up from 30');
  });

  it('says when nothing ran, and when the pass rate is unknown', () => {
    expect(composeReport({ ...BASE, runs: 0, passRate: null }).sentence).toBe(
      'Nothing ran in this period.',
    );
    expect(composeReport({ ...BASE, runs: 1, passRate: null }).sentence).toBe(
      '1 run in this period.',
    );
  });

  it('links only an http(s) URL', () => {
    expect(composeReport({ ...BASE, link: 'javascript:alert(1)' }).link).toBeNull();
    expect(composeReport({ ...BASE, link: 'not a url' }).link).toBeNull();
    expect(composeReport({ ...BASE, link: null }).link).toBeNull();
  });
});

const NEWSY = composeReport({
  ...BASE,
  attention: [{ severity: 'bad', text: 'Run <#812> failed & 3 tests "broke"' }],
  digest: [{ kind: 'new-flaky', tone: 'bad', text: '2 new flaky tests' }],
});

describe('the renderers', () => {
  it('Slack: bold title, escaped text, one link', () => {
    expect(renderSlack(NEWSY)).toBe(
      [
        '*🔴 Weekly quality report*',
        '97.1% passed across 42 runs.',
        '🔴 Run &lt;#812&gt; failed &amp; 3 tests "broke"',
        '🔴 2 new flaky tests',
        '<https://lupin.local:8443/dashboard/now|Open the dashboard>',
      ].join('\n'),
    );
  });

  it('Telegram: HTML with the same escaping and a real anchor', () => {
    expect(renderTelegram(NEWSY)).toBe(
      [
        '<b>🔴 Weekly quality report</b>',
        '97.1% passed across 42 runs.',
        '🔴 Run &lt;#812&gt; failed &amp; 3 tests "broke"',
        '🔴 2 new flaky tests',
        '<a href="https://lupin.local:8443/dashboard/now">Open the dashboard</a>',
      ].join('\n'),
    );
  });

  it('WhatsApp and Signal: plain text, the link last', () => {
    expect(renderPlain(NEWSY)).toBe(
      [
        '🔴 Weekly quality report',
        '97.1% passed across 42 runs.',
        '🔴 Run <#812> failed & 3 tests "broke"',
        '🔴 2 new flaky tests',
        'https://lupin.local:8443/dashboard/now',
      ].join('\n'),
    );
  });

  it('Teams: an Adaptive Card with a title block and an open-URL action', () => {
    const card = renderTeams(composeReport({ ...BASE, digest: [], attention: [] }));
    const content = card.attachments[0]?.content as {
      body: Array<{ text: string; weight?: string }>;
      actions: Array<{ url: string }>;
    };
    expect(content.body[0]).toMatchObject({ text: '🟢 Weekly quality report', weight: 'Bolder' });
    expect(content.actions[0]?.url).toBe('https://lupin.local:8443/dashboard/now');
    expect(
      'actions' in
        (renderTeams(composeReport({ ...BASE, link: null })).attachments[0]?.content ?? {}),
    ).toBe(false);
  });

  it('says how many more there are', () => {
    const many = composeReport({
      ...BASE,
      attention: Array.from({ length: 5 }, (_, index) => ({
        severity: 'bad' as const,
        text: `Run ${String(index)} failed`,
      })),
    });
    expect(renderPlain(many)).toContain('+2 more');
  });

  it('trims a line that does not fit on its raw text, never inside an entity', () => {
    const long = composeReport({
      ...BASE,
      link: null,
      attention: [{ severity: 'bad', text: '&'.repeat(200) }],
    });
    const text = renderTelegram(long, 120);
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text).toMatch(/(&amp;)+…$/u);
    expect(renderSlack(long, 120).length).toBeLessThanOrEqual(120);
    expect(renderPlain(long, 80).length).toBeLessThanOrEqual(80);
  });

  it('drops the link before it would break the limit', () => {
    const tiny = composeReport({ ...BASE, link: `https://example.com/${'x'.repeat(200)}` });
    expect(renderPlain(tiny, 100).length).toBeLessThanOrEqual(100);
    expect(renderTelegram(tiny, 100).length).toBeLessThanOrEqual(100);
    expect(renderSlack(tiny, 100).length).toBeLessThanOrEqual(100);
  });
});

describe('the digest areas and the top actions', () => {
  const pass = (project: string, score: number) => ({
    project,
    status: 'pass' as const,
    score,
    reasons: [],
  });
  const fail = (project: string, score: number | null, ...reasons: string[]) => ({
    project,
    status: 'fail' as const,
    score,
    reasons,
  });
  const DIGEST: ReportInput = {
    ...BASE,
    areas: [
      {
        label: 'DORA',
        cards: [pass('checkout', 82), fail('billing', 41, 'Lead time 90 h is above 48 h.')],
      },
      { label: 'AI code', cards: [pass('checkout', 90), pass('billing', 70)] },
      {
        label: 'Agent quality',
        cards: [{ project: 'checkout', status: 'not_configured', score: null, reasons: [] }],
      },
      { label: 'Ignored fourth', cards: [pass('x', 1)] },
    ],
    scorecards: [fail('billing', 0, '1 critical vulnerability with a fix available is open.')],
    fixNext: [
      { project: 'checkout', title: 'Fix 2 SQL injection findings', gain: 6.5 },
      { project: 'billing', title: 'Rotate the leaked token', gain: 12 },
    ],
  };

  it('writes one line per area, at most three, with the weakest project named', () => {
    const model = composeReport(DIGEST);
    expect(model.areas).toEqual([
      { tone: 'bad', text: 'DORA: 1 of 2 failing — billing 41' },
      { tone: 'good', text: 'AI code: 2 passing, lowest billing 70' },
      { tone: 'neutral', text: 'Agent quality: not measured yet' },
    ]);
    // A failing area makes the report amber even with nothing else to say.
    expect(model.status).toBe('caution');
  });

  it('lists the top three actions: the biggest fixes, then failing reasons, lowest score first', () => {
    expect(composeReport(DIGEST).actions).toEqual([
      'billing: Rotate the leaked token (+12.0 pts)',
      'checkout: Fix 2 SQL injection findings (+6.5 pts)',
      'billing: 1 critical vulnerability with a fix available is open.',
    ]);
    const reasonsOnly = composeReport({ ...DIGEST, fixNext: [] });
    expect(reasonsOnly.actions).toEqual([
      'billing: 1 critical vulnerability with a fix available is open.',
      'billing: Lead time 90 h is above 48 h.',
    ]);
    const unscored = composeReport({
      ...BASE,
      scorecards: [fail('a', null, 'same'), fail('b', 10, 'first'), fail('a', null, 'same')],
      fixNext: [{ project: 'p', title: 'not a number', gain: Number.NaN }],
    });
    expect(unscored.actions).toEqual(['b: first', 'a: same']);
  });

  it('renders the actions before the area lines, and leaves an empty area out', () => {
    const plain = renderPlain(composeReport(DIGEST), 2_000);
    expect(plain).toContain('Top actions:\n1. billing: Rotate the leaked token (+12.0 pts)');
    expect(plain.indexOf('Top actions:')).toBeLessThan(plain.indexOf('🔴 DORA'));
    expect(plain).toContain('• Agent quality: not measured yet');
    const noAreas = composeReport({ ...BASE, areas: [{ label: 'DORA', cards: [] }] });
    expect(noAreas.areas).toEqual([]);
    expect(renderPlain(noAreas)).not.toContain('Top actions');
    const teams = JSON.stringify(renderTeams(composeReport(DIGEST)));
    expect(teams).toContain('1. billing: Rotate the leaked token');
  });

  it('escapes a hostile project name in every line it reaches', () => {
    const model = composeReport({
      ...BASE,
      areas: [{ label: 'DORA', cards: [fail('<b>&evil', 3, 'x < y')] }],
    });
    const telegram = renderTelegram(model);
    expect(telegram).toContain('&lt;b&gt;&amp;evil 3');
    expect(telegram).toContain('&lt;b&gt;&amp;evil: x &lt; y');
    expect(renderSlack(model)).toContain('&lt;b&gt;&amp;evil');
  });
});

describe('the briefing in the digest', () => {
  const briefing = composeBriefing({
    scope: { kind: 'portfolio', projects: 2 },
    now: new Date('2026-11-11T12:00:00.000Z'),
    windowDays: 7,
    merged: { total: 9, ai: 6, highRisk: 2, unreviewedAi: 1, tampered: 1 },
    deployments: 2,
    pace: null,
    bottlenecks: [
      { projectId: 'p-1', projectName: 'Shop', sentence: 'Review is the bottleneck: 3 waiting.' },
    ],
    quality: null,
    decisions: [],
  });

  it('keeps the headline and the lines that need someone, worst first, never the plain notes', () => {
    const block = reportBriefingOf(briefing);
    expect(block.headline).toBe(briefing.headline);
    expect(block.lines).toEqual([
      { tone: 'bad', text: '2 merged at high risk or above.' },
      { tone: 'bad', text: '1 AI-written merged with no person approving.' },
      { tone: 'bad', text: '1 merged with changes that weakened its tests.' },
    ]);
    expect(block.lines).toHaveLength(MAX_BRIEFING_LINES);
  });

  it('is said after the cockpit and before the run sentence, and turns a report yellow, not red', () => {
    const model = composeReport({ ...BASE, briefing: reportBriefingOf(briefing) });
    expect(model.status).toBe('caution');
    const text = renderPlain(model, 4_000);
    expect(text).toContain(`While you were away: ${briefing.headline}`);
    expect(text).toContain('🔴 1 merged with changes that weakened its tests.');
    expect(text.indexOf('While you were away')).toBeLessThan(text.indexOf(model.sentence));
  });

  it('leaves a report without a briefing exactly as it was', () => {
    const model = composeReport(BASE);
    expect(model.briefing).toBeNull();
    expect(renderPlain(model, 4_000)).not.toContain('While you were away');
  });
});
