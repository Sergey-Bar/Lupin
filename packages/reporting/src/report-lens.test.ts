import { describe, expect, it } from 'vitest';
import { applyLens } from './report-lens.js';
import { composeReport, type ReportArea, type ReportInput } from './report.js';

function area(label: string): ReportArea {
  return {
    label,
    cards: [{ project: 'svc', status: 'fail', score: 40, reasons: [`${label} low`] }],
  };
}

const BASE: ReportInput = {
  title: 'Daily quality report',
  runs: 10,
  passRate: 90,
  attention: [],
  digest: [],
  link: 'https://lupin.local/dashboard/now',
  areas: [
    area('DORA'),
    area('AI code'),
    area('Flow'),
    area('Flaky tests'),
    area('Failure clusters'),
    area('Test effectiveness'),
  ],
};

/** The labels, in order, that compose into the model's three area lines. */
function areaLabels(input: ReportInput): string[] {
  return composeReport(input)
    .areas.map((line) => line.text.split(':')[0] ?? '')
    .filter((label) => label.length > 0);
}

describe('applyLens', () => {
  it('is the identity for the general audience, byte for byte', () => {
    expect(applyLens(BASE, 'general')).toBe(BASE);
  });

  it('leads a manager with delivery and readiness', () => {
    // DORA and Flow come first for a manager; the digest keeps three lines, so the SDET-only
    // areas fall off the end rather than leading.
    expect(areaLabels(applyLens(BASE, 'manager')).slice(0, 2)).toEqual(['DORA', 'Flow']);
  });

  it('leads an SDET with the tests that are failing or flaky', () => {
    expect(areaLabels(applyLens(BASE, 'sdet')).slice(0, 2)).toEqual([
      'Flaky tests',
      'Failure clusters',
    ]);
  });

  it('leads a quality owner with effectiveness, then supply chain or AI', () => {
    expect(areaLabels(applyLens(BASE, 'quality'))[0]).toBe('Test effectiveness');
  });

  it('never adds, drops or edits an area — it only reorders', () => {
    const before = [...(BASE.areas ?? [])].map((a) => a.label).sort();
    const after = [...(applyLens(BASE, 'manager').areas ?? [])].map((a) => a.label).sort();
    expect(after).toEqual(before);
  });

  it('keeps the worst-first items and the three-line caps the renderers rely on', () => {
    const input: ReportInput = {
      ...BASE,
      attention: [
        { severity: 'caution', text: 'c' },
        { severity: 'bad', text: 'b' },
      ],
    };
    const lensed = composeReport(applyLens(input, 'manager'));
    // Worst-first is preserved (bad before caution), and the area line cap is still three.
    expect(lensed.items[0]?.tone).toBe('bad');
    expect(lensed.areas.length).toBeLessThanOrEqual(3);
  });

  it('leaves an unlisted area after the promoted ones rather than dropping it', () => {
    // 'Mystery' is in no priority list; a manager still has it, after the promoted areas.
    const withUnknown: ReportInput = { ...BASE, areas: [area('Mystery'), area('DORA')] };
    const ordered = (applyLens(withUnknown, 'manager').areas ?? []).map((a) => a.label);
    expect(ordered).toEqual(['DORA', 'Mystery']);
  });

  it('keeps scorecards and fix-next present and in order under a lens', () => {
    const withExtras: ReportInput = {
      ...BASE,
      scorecards: [
        { project: 'a', status: 'fail', score: 10, reasons: ['x'] },
        { project: 'b', status: 'pass', score: 90, reasons: [] },
      ],
      fixNext: [
        { project: 'a', title: 'fix a', gain: 3 },
        { project: 'b', title: 'fix b', gain: 1 },
      ],
    };
    const lensed = applyLens(withExtras, 'sdet');
    expect(lensed.scorecards?.map((c) => c.project)).toEqual(['a', 'b']);
    expect(lensed.fixNext?.map((f) => f.project)).toEqual(['a', 'b']);
  });

  it('treats an unknown audience defensively as the identity', () => {
    // The enum keeps this unreachable through the contract, but the lens must not throw on a
    // value from an older row; an unknown audience is the general (identity) report.
    expect(applyLens(BASE, 'legacy' as never)).toBe(BASE);
  });
});
