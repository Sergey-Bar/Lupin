import { describe, expect, it } from 'vitest';
import type { Cockpit, CockpitMetric } from '@lupin/shared-contracts';
import { reportCockpitOf } from './cockpit-digest.js';
import {
  TEAMS_IMAGE_MAX_CHARS,
  composeReport,
  renderPlain,
  renderSlack,
  renderTeams,
  renderTelegram,
} from './report.js';

const metric = (extra: Partial<CockpitMetric>): CockpitMetric => ({
  id: 'coverage',
  label: 'Coverage',
  unit: 'percent',
  higherIsBetter: true,
  value: 60,
  baseline: 70,
  delta: -10,
  status: 'worse',
  series: [],
  drivers: [],
  ...extra,
});

function cockpit(extra: Partial<Cockpit> = {}): Cockpit {
  return {
    projectId: 'p-1',
    projectName: 'Service',
    branch: 'main',
    window: '7d',
    generatedAt: '2026-10-26T12:00:00.000Z',
    since: '2026-10-19T12:00:00.000Z',
    headline: 'Down 6 points since last week, mostly lower coverage and more flaky tests.',
    overall: { score: 74, letter: 'C', baseline: 80, delta: -6, status: 'worse', drivers: [] },
    formulaBreak: null,
    metrics: [],
    pace: [],
    risks: { total: 0, items: [] },
    repository: null,
    ...extra,
  };
}

describe('reportCockpitOf', () => {
  it('leads with the cockpit’s own sentence and reads a fall as bad', () => {
    const digest = reportCockpitOf(cockpit());
    expect(digest.headline).toBe(
      'Down 6 points since last week, mostly lower coverage and more flaky tests.',
    );
    expect(digest.tone).toBe('bad');
  });

  it('reads a rise or no change as good, and anything it cannot compare as a caution', () => {
    const tone = (status: Cockpit['overall']['status']) =>
      reportCockpitOf(cockpit({ overall: { ...cockpit().overall, status } })).tone;
    expect(tone('improved')).toBe('good');
    expect(tone('flat')).toBe('good');
    expect(tone('worse')).toBe('bad');
    expect(tone('not_measured')).toBe('caution');
    expect(tone('no_baseline')).toBe('caution');
    expect(tone('formula_changed')).toBe('caution');
  });

  it('lists the metrics that moved most, worst direction named, at most three', () => {
    const digest = reportCockpitOf(
      cockpit({
        metrics: [
          metric({
            id: 'security',
            label: 'Security',
            unit: 'score',
            value: 88,
            baseline: 90,
            delta: -2,
          }),
          metric({ id: 'coverage', label: 'Coverage', value: 60, baseline: 70, delta: -10 }),
          metric({
            id: 'flaky-tests',
            label: 'Flaky tests',
            unit: 'count',
            higherIsBetter: false,
            value: 5,
            baseline: 2,
            delta: 3,
          }),
          metric({
            id: 'run-pass-rate',
            label: 'Run pass rate',
            value: 91.5,
            baseline: 80,
            delta: 11.5,
            status: 'improved',
          }),
        ],
      }),
    );
    expect(digest.changes).toEqual([
      { tone: 'good', text: 'Run pass rate rose 11.5 pts (80% → 91.5%)' },
      { tone: 'bad', text: 'Coverage fell 10 pts (70% → 60%)' },
      { tone: 'bad', text: 'Flaky tests rose by 3 (2 → 5)' },
    ]);
  });

  it('says nothing of a metric that held, was not measured or could not be compared', () => {
    const digest = reportCockpitOf(
      cockpit({
        metrics: [
          metric({ status: 'flat', delta: 0.2 }),
          metric({
            id: 'tests',
            label: 'Tests',
            status: 'not_measured',
            value: null,
            baseline: null,
            delta: null,
          }),
          metric({
            id: 'security',
            label: 'Security',
            status: 'no_baseline',
            baseline: null,
            delta: null,
          }),
          metric({
            id: 'dependencies',
            label: 'Dependencies',
            status: 'formula_changed',
            delta: null,
          }),
        ],
      }),
    );
    expect(digest.changes).toEqual([]);
  });

  it('breaks a tie in the size of the move by the order the cockpit lists the metrics', () => {
    const digest = reportCockpitOf(
      cockpit({
        metrics: [
          metric({
            id: 'tests',
            label: 'Tests',
            unit: 'score',
            value: 70,
            baseline: 75,
            delta: -5,
          }),
          metric({
            id: 'security',
            label: 'Security',
            unit: 'score',
            value: 85,
            baseline: 90,
            delta: -5,
          }),
        ],
      }),
    );
    expect(digest.changes.map((change) => change.text.split(' ')[0])).toEqual([
      'Tests',
      'Security',
    ]);
  });

  it('does not show a number it was not given', () => {
    // A move needs both ends; a payload that claims one without them shows nothing of it.
    const digest = reportCockpitOf(
      cockpit({ metrics: [metric({ value: null, baseline: null, delta: -10 })] }),
    );
    expect(digest.changes).toEqual([]);
  });
});

describe('the digest with the cockpit', () => {
  const model = (extra: Partial<Cockpit> = {}) =>
    composeReport({
      title: 'Weekly',
      runs: 4,
      passRate: 75,
      attention: [],
      digest: [],
      link: 'https://lupin.example/dashboard',
      cockpit: reportCockpitOf(cockpit({ metrics: [metric({ id: 'coverage' })], ...extra })),
    });

  it('puts the headline and the changes before everything else but the title', () => {
    const lines = renderPlain(model(), 2_000).split('\n');
    expect(lines[0]).toContain('Weekly');
    expect(lines[1]).toBe(
      'Down 6 points since last week, mostly lower coverage and more flaky tests.',
    );
    expect(lines[2]).toBe('🔴 Coverage fell 10 pts (70% → 60%)');
    expect(lines[3]).toBe('75% passed across 4 runs.');
  });

  it('is not a green report when the score fell, and not red either unless something needs someone', () => {
    expect(model().status).toBe('caution');
    const flat = model({ overall: { ...cockpit().overall, status: 'flat' }, metrics: [] });
    expect(flat.status).toBe('good');
  });

  it('is unchanged when the workspace has no cockpit', () => {
    const without = composeReport({
      title: 'Weekly',
      runs: 4,
      passRate: 75,
      attention: [],
      digest: [],
      link: null,
    });
    expect(without.cockpit).toBeNull();
    expect(renderPlain(without, 2_000).split('\n')[1]).toBe('75% passed across 4 runs.');
  });

  it('keeps the headline when a platform’s limit cuts the rest', () => {
    const tight = renderTelegram(model(), 140);
    expect(tight).toContain('Down 6 points since last week');
    expect(renderSlack(model(), 140)).toContain('Down 6 points since last week');
  });

  it('escapes what the cockpit says for the platform that reads markup', () => {
    const hostile = model({ headline: 'Down <b>6</b> & more' });
    expect(renderTelegram(hostile, 2_000)).toContain('Down &lt;b&gt;6&lt;/b&gt; &amp; more');
    expect(renderSlack(hostile, 2_000)).toContain('Down &lt;b&gt;6&lt;/b&gt; &amp; more');
  });
});

describe('renderTeams with the chart', () => {
  const model = composeReport({
    title: 'Weekly',
    runs: 1,
    passRate: 100,
    attention: [],
    digest: [],
    link: null,
  });
  const image = {
    dataUri: `data:image/png;base64,${'A'.repeat(100)}`,
    alt: 'The pace chart',
  };
  const body = (card: ReturnType<typeof renderTeams>) =>
    (card.attachments[0]?.content['body'] ?? []) as Array<Record<string, unknown>>;

  it('puts the picture under the title, with its alternative text', () => {
    const blocks = body(renderTeams(model, image));
    expect(blocks[0]).toMatchObject({ type: 'TextBlock', size: 'Large' });
    expect(blocks[1]).toEqual({
      type: 'Image',
      url: image.dataUri,
      altText: 'The pace chart',
      size: 'Stretch',
    });
    expect(blocks[2]).toMatchObject({ type: 'TextBlock' });
  });

  it('is the same card as before when there is no picture', () => {
    expect(renderTeams(model)).toEqual(renderTeams(model, undefined));
    expect(body(renderTeams(model)).some((block) => block['type'] === 'Image')).toBe(false);
  });

  it('leaves out a picture that is too heavy for a card, and one that is not a PNG address', () => {
    const heavy = {
      ...image,
      dataUri: `data:image/png;base64,${'A'.repeat(TEAMS_IMAGE_MAX_CHARS)}`,
    };
    expect(body(renderTeams(model, heavy)).some((block) => block['type'] === 'Image')).toBe(false);
    const remote = { ...image, dataUri: 'https://example.test/chart.png' };
    expect(body(renderTeams(model, remote)).some((block) => block['type'] === 'Image')).toBe(false);
    const script = { ...image, dataUri: 'data:text/html;base64,PHNjcmlwdD4=' };
    expect(body(renderTeams(model, script)).some((block) => block['type'] === 'Image')).toBe(false);
  });
});
