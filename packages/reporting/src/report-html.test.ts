import { describe, expect, it } from 'vitest';
import { renderFullReport } from './report-html.js';
import { composeReport, type ReportInput } from './report.js';

const OPTIONS = { generatedAt: '2026-11-03T09:00:00.000Z', scope: 'default workspace' };

function model(overrides: Partial<ReportInput> = {}) {
  return composeReport({
    title: 'Daily quality report',
    runs: 20,
    passRate: 80,
    attention: [{ severity: 'bad', text: 'checkout failed 3 times' }],
    digest: [],
    link: 'https://lupin.local/dashboard/now',
    areas: [
      { label: 'DORA', cards: [{ project: 'svc', status: 'fail', score: 40, reasons: ['slow'] }] },
    ],
    fixNext: [{ project: 'svc', title: 'add a smoke test', gain: 4.2 }],
    ...overrides,
  });
}

describe('renderFullReport', () => {
  it('is one self-contained document that fetches nothing', () => {
    const html = renderFullReport(model(), OPTIONS);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // A Content-Security-Policy that forbids every remote fetch.
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/u);
    expect(html).not.toMatch(/src=/u);
    // No external stylesheet or font link — the style is inline and token-based.
    expect(html).not.toMatch(/<link/u);
  });

  it('carries the status, the sentence, the items, the areas and the actions', () => {
    const html = renderFullReport(model(), OPTIONS);
    expect(html).toContain('Daily quality report');
    expect(html).toContain('Needs attention');
    expect(html).toContain('80% passed across 20 runs.');
    expect(html).toContain('checkout failed 3 times');
    expect(html).toContain('DORA:');
    expect(html).toContain('add a smoke test');
  });

  it('escapes every value that came from outside', () => {
    const html = renderFullReport(
      model({ attention: [{ severity: 'bad', text: '<img src=x onerror=alert(1)>' }] }),
      OPTIONS,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('follows an https link and refuses anything else', () => {
    expect(renderFullReport(model({ link: 'https://ok.example/x' }), OPTIONS)).toContain(
      'href="https://ok.example/x"',
    );
    const unsafe = renderFullReport(model({ link: 'javascript:alert(1)' }), OPTIONS);
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).not.toContain('Open the dashboard');
  });

  it('is deterministic: the same model and time produce the same bytes', () => {
    expect(renderFullReport(model(), OPTIONS)).toBe(renderFullReport(model(), OPTIONS));
  });

  it('leads with the cockpit headline in each tone when one is present', () => {
    for (const tone of ['good', 'bad', 'caution'] as const) {
      const html = renderFullReport(
        model({
          cockpit: {
            headline: 'Down 6 points since last week',
            tone,
            changes: [{ tone: 'bad', text: 'coverage fell' }],
          },
        }),
        OPTIONS,
      );
      expect(html).toContain('Down 6 points since last week');
      expect(html).toContain('What moved');
      expect(html).toContain('coverage fell');
    }
  });

  it('omits empty sections and says so when nothing needs a person', () => {
    // No attention, no digest, no areas, no fixes, no cockpit, no scope: the empty sections
    // render nothing and the items section states the all-clear.
    const html = renderFullReport(
      composeReport({
        title: 'Quiet day',
        runs: 5,
        passRate: 100,
        attention: [],
        digest: [],
        link: null,
      }),
      { generatedAt: OPTIONS.generatedAt },
    );
    expect(html).toContain('Nothing needs a person in this window.');
    expect(html).not.toContain('>Areas<');
    expect(html).not.toContain('>Top actions<');
    expect(html).not.toContain('>What moved<');
    // No link means no "Open the dashboard" and no scope beyond the generated time.
    expect(html).not.toContain('Open the dashboard');
  });
});
