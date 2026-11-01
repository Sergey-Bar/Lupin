import { describe, expect, it } from 'vitest';
import type { CockpitDriver, CockpitPaceWeek } from '@lupin/shared-contracts';
import { cockpitFixture, cockpitMetric } from '../test-utils.js';
import {
  commitUrl,
  deeperLinks,
  driverText,
  formatDelta,
  formatValue,
  hasScoreImpact,
  noteOfStatus,
  paceGeometry,
  scoreImpactOf,
  seriesGeometry,
  toneOfStatus,
  trendOfDelta,
  verdictOfStatus,
} from './cockpit-view.js';

const week = (weekStart: string, extra: Partial<CockpitPaceWeek> = {}): CockpitPaceWeek => ({
  weekStart,
  partial: false,
  merged: 0,
  linesChanged: 0,
  aiAuthored: 0,
  unattributed: 0,
  aiShare: null,
  score: null,
  formulaVersion: null,
  ...extra,
});

const weeks = (count: number, extra: (index: number) => Partial<CockpitPaceWeek> = () => ({})) =>
  Array.from({ length: count }, (_, index) =>
    week(`2026-08-${String(10 + index).padStart(2, '0')}`, extra(index)),
  );

describe('words for a status', () => {
  it('only a real comparison is better or worse; everything else is unknown or the same', () => {
    expect(verdictOfStatus('improved')).toBe('better');
    expect(verdictOfStatus('worse')).toBe('worse');
    expect(verdictOfStatus('flat')).toBe('same');
    for (const status of ['not_measured', 'no_baseline', 'formula_changed'] as const) {
      expect(verdictOfStatus(status)).toBe('unknown');
    }
  });

  it('is a caution, not a pass, when there is nothing to compare', () => {
    expect(toneOfStatus('worse')).toBe('bad');
    expect(toneOfStatus('improved')).toBe('good');
    expect(toneOfStatus('flat')).toBe('good');
    for (const status of ['not_measured', 'no_baseline', 'formula_changed'] as const) {
      expect(toneOfStatus(status)).toBe('caution');
    }
  });

  it('says why there is no change, and says nothing when there is one', () => {
    expect(noteOfStatus('not_measured')).toBe('Not measured in this window');
    expect(noteOfStatus('no_baseline')).toBe('No earlier reading to compare with');
    expect(noteOfStatus('formula_changed')).toBe('Scoring formula changed, so no comparison');
    expect(noteOfStatus('flat')).toBe('No meaningful change');
    expect(noteOfStatus('improved')).toBeNull();
    expect(noteOfStatus('worse')).toBeNull();
  });
});

describe('numbers', () => {
  it('shows a missing value as a dash, never as 0', () => {
    expect(formatValue('score', null)).toBe('\u2014');
    expect(formatValue('percent', null)).toBe('\u2014');
    expect(formatValue('count', null)).toBe('\u2014');
  });

  it('shows a fraction only when there is one', () => {
    expect(formatValue('score', 76)).toBe('76');
    expect(formatValue('score', 76.5)).toBe('76.5');
    expect(formatValue('percent', 66.7)).toBe('66.7%');
    expect(formatValue('percent', 25)).toBe('25%');
    expect(formatValue('count', 5)).toBe('5');
  });

  it('signs a change and names its unit: points for a score or a rate, a bare count for a count', () => {
    expect(formatDelta('score', -4)).toBe('-4 pts');
    expect(formatDelta('score', 4.5)).toBe('+4.5 pts');
    expect(formatDelta('percent', -41.7)).toBe('-41.7 pts');
    expect(formatDelta('count', 3)).toBe('+3');
    expect(formatDelta('count', -2)).toBe('-2');
    expect(formatDelta('score', 0)).toBe('0 pts');
    expect(formatDelta('score', null)).toBeNull();
  });

  it('reads a trend from the sign of the change', () => {
    expect(trendOfDelta(3)).toBe('up');
    expect(trendOfDelta(-3)).toBe('down');
    expect(trendOfDelta(0)).toBe('flat');
    expect(trendOfDelta(null)).toBeUndefined();
  });
});

describe('driverText', () => {
  const driver = (extra: Partial<CockpitDriver>): CockpitDriver => ({
    kind: 'run',
    ref: 'run-1',
    label: 'Run on abc1234',
    url: null,
    candidate: false,
    change: -3,
    at: null,
    ...extra,
  });

  it('says a candidate is only possible, so it is never read as the cause', () => {
    expect(driverText(driver({ candidate: true }))).toBe('Possibly: Run on abc1234');
  });

  it('shows a known cause as it is', () => {
    expect(driverText(driver({}))).toBe('Run on abc1234');
  });
});

describe('paceGeometry', () => {
  it('draws one bar per week, left to right, and none for a week with nothing merged', () => {
    const geometry = paceGeometry(weeks(12, (index) => ({ merged: index === 3 ? 4 : 0 })));
    expect(geometry.bars).toHaveLength(12);
    const xs = geometry.bars.map((bar) => bar.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(geometry.bars.filter((bar) => bar.otherHeight + bar.aiHeight > 0)).toHaveLength(1);
  });

  it('scales every bar to the busiest week and stacks the AI part under the rest', () => {
    const geometry = paceGeometry(
      weeks(12, (index) =>
        index === 0
          ? { merged: 4, aiAuthored: 1 }
          : index === 1
            ? { merged: 2, aiAuthored: 2 }
            : {},
      ),
    );
    const [first, second] = geometry.bars;
    expect(geometry.maxMerged).toBe(4);
    expect((first?.aiHeight ?? 0) + (first?.otherHeight ?? 0)).toBe(64);
    expect(first?.aiHeight).toBe(16);
    expect(first?.otherHeight).toBe(48);
    // The AI part sits on the baseline, the rest above it.
    expect(first?.aiY).toBe(72 - 16);
    expect(first?.otherY).toBe(72 - 16 - 48);
    expect(second?.aiHeight).toBe(32);
    expect(second?.otherHeight).toBe(0);
  });

  it('does not divide by zero when nothing merged in any week', () => {
    const geometry = paceGeometry(weeks(12));
    expect(geometry.maxMerged).toBe(1);
    expect(geometry.bars.every((bar) => bar.aiHeight === 0 && bar.otherHeight === 0)).toBe(true);
  });

  it('marks the partial week', () => {
    const geometry = paceGeometry(weeks(12, (index) => ({ partial: index === 11 })));
    expect(geometry.bars.map((bar) => bar.partial).filter(Boolean)).toHaveLength(1);
    expect(geometry.bars[11]?.partial).toBe(true);
  });

  it('joins the score of consecutive weeks into one line', () => {
    const geometry = paceGeometry(
      weeks(12, (index) => (index < 4 ? { score: 50 + index, formulaVersion: 1 } : {})),
    );
    expect(geometry.scorePaths).toHaveLength(1);
    expect(geometry.scorePaths[0]?.startsWith('M ')).toBe(true);
    expect(geometry.scoreDots).toHaveLength(4);
  });

  it('stops the line at a week with no score instead of leaning across the gap', () => {
    const geometry = paceGeometry(
      weeks(12, (index) =>
        index === 2 || index === 3 || index === 5 || index === 6
          ? { score: 60, formulaVersion: 1 }
          : {},
      ),
    );
    expect(geometry.scorePaths).toHaveLength(2);
    expect(geometry.formulaBreaks).toEqual([]);
  });

  it('breaks the line where the formula changed, and says where', () => {
    const geometry = paceGeometry(
      weeks(12, (index) =>
        index < 6
          ? { score: 80, formulaVersion: 1 }
          : index < 9
            ? { score: 60, formulaVersion: 2 }
            : {},
      ),
    );
    expect(geometry.scorePaths).toHaveLength(2);
    expect(geometry.formulaBreaks).toHaveLength(1);
    // The break sits between the sixth and seventh week.
    const dots = geometry.scoreDots;
    const middle = ((dots[5]?.x ?? 0) + (dots[6]?.x ?? 0)) / 2;
    expect(geometry.formulaBreaks[0]).toBeCloseTo(middle, 1);
  });

  it('puts a higher score higher on the page', () => {
    const geometry = paceGeometry(
      weeks(12, (index) =>
        index === 0
          ? { score: 90, formulaVersion: 1 }
          : index === 1
            ? { score: 30, formulaVersion: 1 }
            : {},
      ),
    );
    expect((geometry.scoreDots[0]?.y ?? 0) < (geometry.scoreDots[1]?.y ?? 0)).toBe(true);
  });

  it('draws a lone graded week as a dot and no line', () => {
    const geometry = paceGeometry(
      weeks(12, (index) => (index === 5 ? { score: 70, formulaVersion: 1 } : {})),
    );
    expect(geometry.scorePaths).toEqual([]);
    expect(geometry.scoreDots).toHaveLength(1);
  });

  it('handles no weeks at all', () => {
    const geometry = paceGeometry([]);
    expect(geometry.bars).toEqual([]);
    expect(geometry.scorePaths).toEqual([]);
  });
});

describe('deeperLinks', () => {
  const ids = [
    'security',
    'tests',
    'code-quality',
    'dependencies',
    'coverage',
    'flaky-tests',
    'run-pass-rate',
  ] as const;

  it('gives every metric somewhere to go, and every link a label, a sentence and a path', () => {
    for (const id of ids) {
      const links = deeperLinks(id, 'p-1');
      expect(links.length, id).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.label.length, `${id}: label`).toBeGreaterThan(0);
        expect(link.description.length, `${id}: description`).toBeGreaterThan(0);
        expect(link.to.startsWith('/dashboard/'), `${id}: ${link.to}`).toBe(true);
      }
    }
  });

  it('sends the pages that were folded under their metric to where they always were', () => {
    expect(deeperLinks('coverage', 'p-1').map((link) => link.to)).toEqual(['/dashboard/gaps/p-1']);
    expect(deeperLinks('flaky-tests', 'p-1').map((link) => link.to)).toEqual([
      '/dashboard/flaky/p-1',
      '/dashboard/quarantine',
    ]);
    expect(deeperLinks('run-pass-rate', 'p-1').map((link) => link.to)).toEqual([
      '/dashboard/runs',
      '/dashboard/analytics',
    ]);
    expect(deeperLinks('security', 'p-1').map((link) => link.to)).toEqual(['/dashboard/repo/p-1']);
  });

  it('encodes a project id rather than splicing it into the path', () => {
    expect(deeperLinks('coverage', 'a/b c').map((link) => link.to)).toEqual([
      '/dashboard/gaps/a%2Fb%20c',
    ]);
  });
});

describe('scoreImpactOf', () => {
  const run = (ref: string, candidate: boolean, change = -3): CockpitDriver => ({
    kind: 'run',
    ref,
    label: `Run ${ref}`,
    url: null,
    candidate,
    change,
    at: null,
  });
  const cockpit = cockpitFixture({
    overall: { ...cockpitFixture().overall, drivers: [run('run-1', false, -6)] },
    metrics: [
      cockpitMetric({ id: 'coverage', label: 'Coverage', drivers: [run('run-1', true, -10)] }),
      cockpitMetric({ id: 'tests', label: 'Tests', drivers: [run('run-2', true)] }),
      cockpitMetric({ id: 'security', label: 'Security', drivers: [] }),
    ],
  });

  it('lists the metrics that name the run and whether the score itself does', () => {
    const impact = scoreImpactOf(cockpit, 'run-1');
    expect(impact.overall).toBe(true);
    expect(impact.metrics).toEqual([
      { id: 'coverage', label: 'Coverage', change: -10, candidate: true },
    ]);
    expect(hasScoreImpact(impact)).toBe(true);
  });

  it('is empty for a run the cockpit does not name', () => {
    const impact = scoreImpactOf(cockpit, 'run-9');
    expect(impact).toEqual({ overall: false, metrics: [] });
    expect(hasScoreImpact(impact)).toBe(false);
  });

  it('names a run only by a run driver, not by a pull request that happens to share its ref', () => {
    const lookalike = cockpitFixture({
      overall: {
        ...cockpitFixture().overall,
        drivers: [{ ...run('42', false), kind: 'pull_request' }],
      },
      metrics: [],
    });
    expect(hasScoreImpact(scoreImpactOf(lookalike, '42'))).toBe(false);
  });
});

describe('commitUrl', () => {
  it('links the commit on the project’s GitHub repository, and only then', () => {
    expect(commitUrl(cockpitFixture(), 'abc1234')).toBe(
      'https://github.com/octo/service/commit/abc1234',
    );
    expect(commitUrl(cockpitFixture({ repository: null }), 'abc1234')).toBeNull();
    expect(commitUrl(cockpitFixture(), null)).toBeNull();
  });
});

describe('seriesGeometry', () => {
  const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;

  it('draws nothing for no readings, and says there is nothing rather than a flat line', () => {
    const geometry = seriesGeometry([]);
    expect(geometry.path).toBeNull();
    expect(geometry.dots).toEqual([]);
    expect(geometry.firstAt).toBeNull();
  });

  it('draws one reading as a dot in the middle and no line', () => {
    const geometry = seriesGeometry([{ at: at(1), value: 70 }]);
    expect(geometry.path).toBeNull();
    expect(geometry.dots).toHaveLength(1);
    expect(geometry.dots[0]?.x).toBe(300);
  });

  it('puts a higher value higher on the page and the readings left to right', () => {
    const geometry = seriesGeometry([
      { at: at(1), value: 10 },
      { at: at(2), value: 90 },
      { at: at(3), value: 50 },
    ]);
    const [first, second, third] = geometry.dots;
    expect((second?.y ?? 0) < (third?.y ?? 0)).toBe(true);
    expect((third?.y ?? 0) < (first?.y ?? 0)).toBe(true);
    expect((first?.x ?? 0) < (second?.x ?? 0)).toBe(true);
    expect((second?.x ?? 0) < (third?.x ?? 0)).toBe(true);
    expect(geometry.path?.startsWith('M ')).toBe(true);
    expect([geometry.min, geometry.max]).toEqual([10, 90]);
    expect([geometry.firstAt, geometry.lastAt]).toEqual([at(1), at(3)]);
  });

  it('draws a flat series as a line, not as nothing', () => {
    const geometry = seriesGeometry([
      { at: at(1), value: 5 },
      { at: at(2), value: 5 },
      { at: at(3), value: 5 },
    ]);
    expect(geometry.path).not.toBeNull();
    expect(new Set(geometry.dots.map((dot) => dot.y)).size).toBe(1);
  });

  it('skips a reading that is not a number rather than drawing it at the edge', () => {
    const geometry = seriesGeometry([
      { at: at(1), value: 10 },
      { at: at(2), value: Number.NaN },
      { at: at(3), value: 20 },
    ]);
    expect(geometry.dots.map((dot) => dot.value)).toEqual([10, 20]);
  });
});
