import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Cockpit, CockpitMetric, CockpitPaceWeek } from '@lupin/shared-contracts';
import { REPORT_TOKENS, escapeHtml, renderCockpitHtml } from './cockpit-html.js';

const metric = (extra: Partial<CockpitMetric> = {}): CockpitMetric => ({
  id: 'coverage',
  label: 'Coverage',
  unit: 'percent',
  higherIsBetter: true,
  value: 60,
  baseline: 70,
  delta: -10,
  status: 'worse',
  series: [
    { at: '2026-10-18T12:00:00.000Z', value: 70 },
    { at: '2026-10-25T12:00:00.000Z', value: 60 },
  ],
  drivers: [],
  ...extra,
});

const week = (index: number, extra: Partial<CockpitPaceWeek> = {}): CockpitPaceWeek => ({
  weekStart: new Date(Date.UTC(2026, 7, 10 + index * 7)).toISOString().slice(0, 10),
  partial: index === 11,
  merged: index % 4,
  linesChanged: (index % 4) * 40,
  aiAuthored: index % 2,
  unattributed: 0,
  aiShare: index % 4 === 0 ? null : 25,
  score: index < 3 ? null : 70 + index,
  formulaVersion: index < 3 ? null : 1,
  ...extra,
});

function cockpit(extra: Partial<Cockpit> = {}): Cockpit {
  return {
    projectId: '00000000-0000-4000-8000-000000000001',
    projectName: 'Service',
    branch: 'main',
    window: '7d',
    generatedAt: '2026-10-26T12:00:00.000Z',
    since: '2026-10-19T12:00:00.000Z',
    headline: 'Down 6 points since last week, mostly lower coverage and more flaky tests.',
    overall: {
      score: 74,
      letter: 'C',
      baseline: 80,
      delta: -6,
      status: 'worse',
      drivers: [
        {
          kind: 'pull_request',
          ref: '42',
          label: 'PR #42: Rewrite the cache',
          url: 'https://github.com/octo/service/pull/42',
          candidate: false,
          change: -6,
          at: '2026-10-24T12:00:00.000Z',
        },
      ],
    },
    formulaBreak: null,
    metrics: [
      metric({
        drivers: [
          {
            kind: 'run',
            ref: 'run-2',
            label: 'Run on abc1234',
            url: null,
            candidate: true,
            change: -10,
            at: null,
          },
        ],
      }),
      metric({
        id: 'flaky-tests',
        label: 'Flaky tests',
        unit: 'count',
        higherIsBetter: false,
        value: 5,
        baseline: 2,
        delta: 3,
        status: 'worse',
      }),
      metric({
        id: 'code-quality',
        label: 'Code quality',
        unit: 'score',
        value: null,
        baseline: null,
        delta: null,
        status: 'not_measured',
        series: [],
      }),
      metric({
        id: 'security',
        label: 'Security',
        unit: 'score',
        value: 90,
        baseline: null,
        delta: null,
        status: 'no_baseline',
      }),
    ],
    pace: Array.from({ length: 12 }, (_, index) => week(index)),
    risks: { total: 0, items: [] },
    repository: { owner: 'octo', repo: 'service' },
    ...extra,
  };
}

/** Event-handler attributes on real tags. Text that spells one out is escaped, so is not a tag. */
const eventHandlers = (page: string): string[] =>
  [...page.matchAll(/<[^>]+>/gu)]
    .map((match) => match[0])
    .filter((tag) => /\son[a-z]+\s*=/u.test(tag));

const html = (extra: Partial<Cockpit> = {}) => renderCockpitHtml(cockpit(extra));

describe('renderCockpitHtml: what it says', () => {
  it('is a complete document in English with a title that names the project and the day', () => {
    const page = html();
    expect(page.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(page).toContain('<title>Cockpit \u00B7 Service \u00B7 2026-10-26</title>');
    expect(page.trimEnd().endsWith('</html>')).toBe(true);
    expect(page.match(/<h1>/gu)).toHaveLength(1);
  });

  it('leads with the score and the cockpit’s own sentence', () => {
    const page = html();
    expect(page).toContain('<p class="score">74</p>');
    expect(page).toContain(
      '<p class="headline">Down 6 points since last week, mostly lower coverage and more flaky tests.</p>',
    );
    expect(page).toContain('tone-bad');
    expect(page).toContain(
      'Service \u00B7 main \u00B7 Last 7 days \u00B7 generated 2026-10-26 12:00 UTC',
    );
  });

  it('names the window it compared with', () => {
    expect(html({ window: 'release' })).toContain('Since the last release');
  });

  it('shows a change only for a real comparison, with its verdict in words', () => {
    const page = html();
    expect(page).toContain('\u25BC -10 pts (worse)');
    expect(page).toContain('\u25B2 +3 (worse)');
    expect(page).toContain('Not measured in this window');
    expect(page).toContain('No earlier reading to compare with');
    // A metric that could not be compared has no delta anywhere in its card.
    const unmeasured = page
      .split('<li class="card">')
      .find((card) => card.includes('Code quality'));
    expect(unmeasured).not.toContain('pts');
    expect(unmeasured).toContain('\u2014');
  });

  it('says the formula changed instead of drawing a change across it', () => {
    const page = html({
      metrics: [metric({ status: 'formula_changed', delta: null })],
      formulaBreak: { at: '2026-10-20T00:00:00.000Z', from: 1, to: 2 },
      pace: Array.from({ length: 12 }, (_, i) =>
        week(i, i < 6 ? { score: 80, formulaVersion: 1 } : { score: 60, formulaVersion: 2 }),
      ),
    });
    expect(page).toContain('Scoring formula changed, so no comparison');
    expect(page).toContain('class="break"');
    expect(page).toContain('the scoring formula changed here');
  });

  it('offers a candidate as only possible, and links a pull request on GitHub', () => {
    const page = html();
    expect(page).toContain('Possibly: Run on abc1234');
    expect(page).toContain(
      '<a href="https://github.com/octo/service/pull/42" target="_blank" rel="noopener noreferrer">See the change</a>',
    );
  });

  it('puts every number of the pace chart in a table', () => {
    const page = html();
    expect(page.match(/<tr>/gu)).toHaveLength(13);
    expect(page).toContain(
      '<th scope="row">2026-10-26 (this week)</th>'.replace('2026-10-26', '2026-10-26'),
    );
    expect(page).toContain('none merged');
    expect(page).toContain('not measured');
    expect(page).toContain('role="img"');
  });

  it('is the same bytes for the same payload, so an artifact changes only when the cockpit does', () => {
    expect(html()).toBe(html());
    expect(html()).not.toBe(html({ headline: 'Up 2 points since last week.' }));
  });

  it('stays small', () => {
    expect(Buffer.byteLength(html(), 'utf8')).toBeLessThan(60_000);
  });
});

describe('renderCockpitHtml: nothing is fetched', () => {
  const page = html();

  it('has no script, link, image, frame, object, embed, form or import', () => {
    for (const tag of [
      '<script',
      '<link',
      '<img',
      '<iframe',
      '<object',
      '<embed',
      '<form',
      '<base',
      '@import',
    ]) {
      expect(page.toLowerCase(), tag).not.toContain(tag);
    }
    expect(page).not.toMatch(/url\(/u);
    expect(eventHandlers(page)).toEqual([]);
  });

  it('says so to the browser, in a policy that forbids everything but its own styles', () => {
    expect(page).toContain(
      `content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"`,
    );
  });

  it('has no address anywhere but the https links a person follows', () => {
    // Anything shaped like an address, with or without a scheme: `https://…`, `http://…`, `//…`.
    const addresses = [...page.matchAll(/(?:https:|http:|)\/\/[^\s"'<>)]+/gu)].map(
      (match) => match[0],
    );
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      // The policy and the `$schema`-free document hold no others; GitHub links are https.
      expect(address.startsWith('https://github.com/'), address).toBe(true);
    }
    // And every one of them is in an anchor, not a source.
    expect(page).not.toMatch(/\b(src|action|data|poster|srcset)=/u);
    for (const match of page.matchAll(/href="([^"]*)"/gu)) {
      expect(match[1]?.startsWith('https://'), match[1]).toBe(true);
    }
  });
});

describe('renderCockpitHtml: what comes from outside', () => {
  const hostile = `"><script>alert(1)</script><img src=x onerror=alert(1)>&'`;

  it('escapes the project, the branch, the headline and the labels', () => {
    const page = html({
      projectName: hostile,
      branch: hostile,
      headline: hostile,
      metrics: [metric({ label: hostile, drivers: [] })],
    });
    expect(page).not.toContain('<script>alert(1)');
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('escapes a pull request title in a driver, and does not let a quote leave its attribute', () => {
    const page = html({
      overall: {
        ...cockpit().overall,
        drivers: [
          {
            kind: 'pull_request',
            ref: '1',
            label: `PR #1: ${hostile}`,
            url: 'https://github.com/o/r/pull/1?x="onmouseover="alert(1)',
            candidate: false,
            change: -1,
            at: null,
          },
        ],
      },
      metrics: [
        metric({
          drivers: [
            {
              kind: 'pull_request',
              ref: '1',
              label: `PR #1: ${hostile}`,
              url: 'https://github.com/o/r/pull/1?x="onmouseover="alert(1)',
              candidate: false,
              change: -1,
              at: null,
            },
          ],
        }),
      ],
    });
    expect(page).not.toContain('<script>alert(1)');
    expect(eventHandlers(page)).toEqual([]);
  });

  it.each([
    'http://github.com/o/r',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'not a url',
    '//evil.example/x',
  ])('does not follow %s', (url) => {
    const page = html({
      overall: {
        ...cockpit().overall,
        drivers: [
          {
            kind: 'commit',
            ref: 'abc',
            label: 'Commit abc',
            url,
            candidate: false,
            change: -1,
            at: null,
          },
        ],
      },
      metrics: [],
    });
    expect(page).not.toContain('See the change');
    expect(page).not.toMatch(/href="(?!https:\/\/)/u);
  });

  it('escapes a week start and a label in the table and the chart', () => {
    const page = html({
      pace: Array.from({ length: 12 }, (_, i) =>
        week(i, i === 0 ? { weekStart: '2026-08-10' } : {}),
      ),
    });
    expect(page).not.toContain('<script');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('renderCockpitHtml: risks', () => {
  const item = {
    kind: 'merged_without_human_approval' as const,
    number: 12,
    title: 'Rework <b>cache</b>',
    url: 'https://github.com/octo/service/pull/12',
    detail: 'Merged with no approval from a person.',
    at: '2026-10-30T10:00:00.000Z',
  };

  it('lists each item with a link and its stated fact, escaped', () => {
    const page = html({ risks: { total: 1, items: [item] } });
    expect(page).toContain('Worth a look');
    expect(page).toContain('href="https://github.com/octo/service/pull/12"');
    expect(page).toContain('Rework &lt;b&gt;cache&lt;/b&gt;');
    expect(page).toContain('Merged with no approval from a person.');
  });

  it('says how many are hidden, and drops an unsafe link instead of rendering it', () => {
    const page = html({
      risks: { total: 14, items: [{ ...item, url: 'javascript:alert(1)' }] },
    });
    expect(page).toContain('Showing the newest 1 of 14.');
    expect(page).not.toContain('javascript:');
  });

  it('says nothing matched, and that it only reads synced pull requests', () => {
    expect(html()).toContain('No pull request matched.');
  });
});

describe('renderCockpitHtml: the colours', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(path.resolve(here, '../../ui/src/tokens/theme.css'), 'utf8');
  const block = (opening: string): string => {
    const start = css.indexOf(opening);
    return css.slice(start, css.indexOf('\n}', start));
  };
  // The dark theme is the stylesheet's `:root, [data-theme='dark']` block, the light is its own.
  const themes = {
    dark: block(":root,\n[data-theme='dark'] {"),
    light: block("[data-theme='light'] {"),
  } as const;

  for (const theme of ['dark', 'light'] as const) {
    it.each(Object.entries(REPORT_TOKENS[theme]))(
      `embeds --lupin-%s of the ${theme} theme exactly as theme.css has it`,
      (name, value) => {
        const match = new RegExp(`--lupin-${name}:\\s*([^;]+);`).exec(themes[theme]);
        expect(match, `--lupin-${name} is not in the ${theme} theme`).not.toBeNull();
        expect(match?.[1]?.trim()).toBe(value);
      },
    );
  }

  it('follows the reader’s colour scheme, light first and dark when asked', () => {
    const page = html();
    expect(page).toContain('color-scheme:light dark');
    expect(page).toContain('@media (prefers-color-scheme:dark)');
    for (const value of Object.values(REPORT_TOKENS.light)) expect(page).toContain(value);
    for (const value of Object.values(REPORT_TOKENS.dark)) expect(page).toContain(value);
  });

  it('holds no colour of its own: no hex, rgb or hsl literal', () => {
    const page = html();
    expect(page).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u);
    expect(page).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/u);
  });
});

describe('renderCockpitHtml: the shapes a payload can take', () => {
  it('shows a metric that rose as better, with its fraction, and draws its line in green', () => {
    const page = html({
      metrics: [
        metric({
          id: 'run-pass-rate',
          label: 'Run pass rate',
          value: 91.5,
          baseline: 80,
          delta: 11.5,
          status: 'improved',
        }),
      ],
    });
    expect(page).toContain('\u25B2 +11.5 pts (better)');
    expect(page).toContain('91.5%');
    expect(page).toContain('class="spark better"');
  });

  it('shows a flat metric in words, and a single reading as a dot with no line', () => {
    const page = html({
      metrics: [
        metric({
          status: 'flat',
          delta: 0.2,
          series: [{ at: '2026-10-25T12:00:00.000Z', value: 60 }],
        }),
      ],
    });
    expect(page).toContain('No meaningful change');
    expect(page).toContain('<circle cx="2"');
    const spark = page.slice(page.indexOf('<svg class="spark'), page.indexOf('</svg>'));
    expect(spark).not.toContain('<path');
  });

  it('says a cause is unknown in a style of its own, and draws no sparkline without readings', () => {
    const page = html({
      metrics: [
        metric({
          series: [],
          drivers: [
            {
              kind: 'unknown',
              ref: null,
              label: 'No run was recorded',
              url: null,
              candidate: false,
              change: -1,
              at: null,
            },
          ],
        }),
      ],
    });
    expect(page).toContain('<p class="unknown">No run was recorded</p>');
    expect(page).not.toContain('<svg class="spark');
  });

  it('has no “See the change” link when the score has no driver', () => {
    const page = html({ overall: { ...cockpit().overall, drivers: [] } });
    expect(page).not.toContain('See the change');
  });

  it('names the agent in the legend only when an agent wrote something', () => {
    const none = html({ pace: Array.from({ length: 12 }, (_, i) => week(i, { aiAuthored: 0 })) });
    expect(none).not.toContain('Written by an agent</span>');
    expect(html()).toContain('Written by an agent</span>');
  });

  it('draws a payload with no weeks, and one whose weeks have no score, without a chart line', () => {
    expect(html({ pace: [] })).toContain('<tbody></tbody>');
    const unscored = html({
      pace: Array.from({ length: 12 }, (_, i) => week(i, { score: null, formulaVersion: null })),
    });
    expect(unscored).not.toContain('class="line"');
    expect(unscored).not.toContain('class="dot"');
  });

  it('breaks the line at a gap, and joins neighbours of one formula', () => {
    const page = html({
      pace: Array.from({ length: 12 }, (_, i) =>
        week(i, i === 5 ? { score: null, formulaVersion: null } : { score: 70, formulaVersion: 1 }),
      ),
    });
    expect(page.match(/class="line"/gu)).toHaveLength(2);
  });

  it('writes whole numbers plainly and fractions with one decimal, and a zero change as 0', () => {
    const page = html({
      metrics: [
        metric({ value: 66.66, baseline: 80, delta: 0, status: 'worse' }),
        metric({
          id: 'tests',
          label: 'Tests',
          unit: 'score',
          value: 70,
          baseline: 75,
          delta: -5.5,
          status: 'worse',
        }),
      ],
    });
    expect(page).toContain('66.7%');
    expect(page).toContain('0 pts (worse)');
    expect(page).toContain('-5.5 pts (worse)');
  });

  it('says nothing under a metric that improved but carries no change to show', () => {
    const page = html({ metrics: [metric({ status: 'improved', delta: null })] });
    expect(page).toContain('<p class="note"></p>');
  });
});
