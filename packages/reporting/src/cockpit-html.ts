import type {
  Cockpit,
  CockpitDriver,
  CockpitMetric,
  CockpitPaceWeek,
  CockpitStatus,
} from '@lupin/shared-contracts';

/**
 * The cockpit as one HTML file: a snapshot a person can attach to a message or publish as a CI
 * artifact, and open without an account, a server or a network.
 *
 * What makes it safe to hand around:
 *
 * - **Nothing is fetched.** No script, no stylesheet link, no image, no font, no form, no
 *   frame, and a `Content-Security-Policy` in the page that forbids them all, so a browser
 *   would refuse one that a later edit added. The only addresses in it are `https://` links
 *   to GitHub in `<a>` elements, which load when a person follows them.
 * - **Every value is escaped.** The project name, the headline, a pull request title and a
 *   commit address come from outside this file; each goes through {@link escapeHtml}, and a
 *   link is followed only if it is `https:`.
 * - **It is deterministic.** The only time in it is the cockpit's own `generatedAt`, so the
 *   same payload is the same bytes and a CI artifact does not change when nothing did.
 *
 * The colours are the product's tokens, by name and by value, in both themes: the file follows
 * the reader's `prefers-color-scheme` as the app does. `cockpit-html.test.ts` reads `theme.css`
 * and fails if a value here drifts from its token. The charts are drawn inline as SVG with the
 * same rules as the screen: a missing reading is a gap, a change of formula breaks the line, and
 * a change that was not measured is said in words and never drawn.
 */

/** The token values this file embeds, by theme. Held to `theme.css` by the test. */
export const REPORT_TOKENS = {
  dark: {
    'surface-sunken': 'oklch(17.79% 0.0064 271.04)',
    surface: 'oklch(21.46% 0.0099 276.58)',
    fg: 'oklch(96.77% 0.0027 286.35)',
    'fg-muted': 'oklch(72.33% 0.0101 279.62)',
    border: 'oklch(30.56% 0.0111 271.04)',
    accent: 'oklch(79.25% 0.0891 292.99)',
    success: 'oklch(72.03% 0.1317 147.83)',
    warning: 'oklch(75.94% 0.1314 71.99)',
    danger: 'oklch(66.66% 0.1313 24.63)',
    'chart-line': 'oklch(73.92% 0.1225 240.43)',
    'chart-grid': 'oklch(29.05% 0.011 278.18)',
    'chart-1': 'oklch(70.99% 0.1188 243.93)',
    'chart-2': 'oklch(80.59% 0.1471 78.99)',
  },
  light: {
    'surface-sunken': 'oklch(93.62% 0.004 106.48)',
    surface: 'oklch(100% 0 0)',
    fg: 'oklch(20.09% 0.0081 274.5)',
    'fg-muted': 'oklch(49.02% 0.0096 278.47)',
    border: 'oklch(89.39% 0.0027 106.45)',
    accent: 'oklch(50.92% 0.1381 290.35)',
    success: 'oklch(47.06% 0.1167 147.84)',
    warning: 'oklch(48.1% 0.0934 71.99)',
    danger: 'oklch(48.07% 0.1437 25.25)',
    'chart-line': 'oklch(48.56% 0.1492 252.88)',
    'chart-grid': 'oklch(91.97% 0.004 286.32)',
    'chart-1': 'oklch(48.56% 0.1492 252.88)',
    'chart-2': 'oklch(56.76% 0.1223 70.84)',
  },
} as const;

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

/** A link is followed only if it is `https:`; anything else is plain text. */
export function safeHref(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).protocol === 'https:' ? new URL(url).href : null;
  } catch {
    return null;
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const plain = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

function formatValue(unit: CockpitMetric['unit'], value: number | null): string {
  if (value === null) return '\u2014';
  return unit === 'percent' ? `${plain(value)}%` : plain(value);
}

function formatDelta(unit: CockpitMetric['unit'], delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  const body = plain(Math.abs(delta));
  return unit === 'count' ? `${sign}${body}` : `${sign}${body} pts`;
}

const NOTE: Partial<Record<CockpitStatus, string>> = {
  not_measured: 'Not measured in this window',
  no_baseline: 'No earlier reading to compare with',
  formula_changed: 'Scoring formula changed, so no comparison',
  flat: 'No meaningful change',
};

const TONE: Record<CockpitStatus, 'good' | 'bad' | 'caution'> = {
  improved: 'good',
  flat: 'good',
  worse: 'bad',
  not_measured: 'caution',
  no_baseline: 'caution',
  formula_changed: 'caution',
};

const WINDOW_LABEL = { '7d': 'Last 7 days', release: 'Since the last release' } as const;

export function tokenBlock(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, value]) => `--lupin-${name}:${value};`)
    .join('');
}

export const REPORT_STYLE = `
:root{color-scheme:light dark;${tokenBlock(REPORT_TOKENS.light)}}
@media (prefers-color-scheme:dark){:root{${tokenBlock(REPORT_TOKENS.dark)}}}
*{box-sizing:border-box}
body{margin:0;background:var(--lupin-surface-sunken);color:var(--lupin-fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:72rem;margin:0 auto;padding:1.5rem 1rem 3rem;display:flex;flex-direction:column;gap:1.5rem}
h1{margin:0;font-size:1.75rem;line-height:1.2;letter-spacing:-.01em}
h2{margin:0 0 .75rem;font-size:.95rem;font-weight:600}
h3{margin:0;font-size:.875rem;font-weight:500;color:var(--lupin-fg-muted)}
p{margin:0}
.scope,.foot{color:var(--lupin-fg-muted);font-size:.875rem}
.panel,.status,.card{background:var(--lupin-surface);border:1px solid var(--lupin-border);border-radius:.5rem;padding:1.25rem}
.status{display:flex;flex-wrap:wrap;align-items:baseline;gap:1rem 1.5rem}
.score{font-size:3.75rem;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
.tone-good .score{color:var(--lupin-success)}
.tone-bad .score{color:var(--lupin-danger)}
.tone-caution .score{color:var(--lupin-warning)}
.headline{font-size:1.125rem;max-width:44rem}
.metrics{list-style:none;margin:0;padding:0;display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))}
.card{display:flex;flex-direction:column;gap:.5rem;padding:1rem}
.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem}
.value{font-size:1.875rem;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.1}
.delta{font-size:.875rem;font-variant-numeric:tabular-nums}
.delta.better{color:var(--lupin-success)}
.delta.worse{color:var(--lupin-danger)}
.note{font-size:.8125rem;color:var(--lupin-fg-muted)}
.drivers{border-top:1px solid var(--lupin-border);padding-top:.5rem;display:flex;flex-direction:column;gap:.25rem;font-size:.8125rem}
.drivers .unknown{color:var(--lupin-fg-muted)}
.risks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
.risks li{border-top:1px solid var(--lupin-border);padding-top:.5rem;font-size:.875rem}
a{color:var(--lupin-accent);text-underline-offset:.15em}
a:focus-visible{outline:2px solid var(--lupin-accent);outline-offset:2px}
svg{display:block;width:100%;height:auto}
.spark{width:6rem;height:2rem;flex:none}
.spark path,.line{fill:none;stroke:var(--lupin-chart-line);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.spark.worse path{stroke:var(--lupin-danger)}
.spark.better path{stroke:var(--lupin-success)}
.spark circle,.dot{fill:var(--lupin-chart-line)}
.grid{stroke:var(--lupin-chart-grid)}
.bar{fill:var(--lupin-chart-1)}
.agent{fill:var(--lupin-chart-2)}
.partial{opacity:.55}
.break{stroke:var(--lupin-warning);stroke-dasharray:3 3}
.axis{fill:var(--lupin-fg-muted);font-size:10px}
.legend{display:flex;flex-wrap:wrap;gap:.25rem 1rem;color:var(--lupin-fg-muted);font-size:.8125rem;margin-top:.5rem}
.swatch{display:inline-block;width:.625rem;height:.625rem;border-radius:2px;margin-right:.375rem}
table{width:100%;border-collapse:collapse;font-size:.8125rem;font-variant-numeric:tabular-nums;margin-top:1rem}
caption{text-align:left;color:var(--lupin-fg-muted);padding-bottom:.375rem}
th,td{padding:.25rem .5rem;border-bottom:1px solid var(--lupin-border);text-align:right}
th:first-child,td:first-child{text-align:left}
@media print{body{background:var(--lupin-surface)}main{padding:0}.panel,.status,.card{break-inside:avoid}}
`.trim();

function sparkline(metric: CockpitMetric): string {
  const values = metric.series.map((point) => point.value).filter(Number.isFinite);
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const span = Math.max(1, Math.max(...values) - min);
  const step = values.length === 1 ? 0 : 92 / (values.length - 1);
  const points = values.map((value, index) => ({
    x: round2(2 + step * index),
    y: round2(2 + 28 - ((value - min) / span) * 28 + 1),
  }));
  const last = points.at(-1) as { x: number; y: number };
  const path =
    points.length < 2
      ? ''
      : `<path d="${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${String(p.x)} ${String(p.y)}`).join(' ')}"/>`;
  const verdict =
    metric.status === 'improved' ? ' better' : metric.status === 'worse' ? ' worse' : '';
  const label = `${metric.label} over time, ${formatValue(metric.unit, metric.value)}`;
  return `<svg class="spark${verdict}" viewBox="0 0 96 32" role="img" aria-label="${escapeHtml(label)}" focusable="false">${path}<circle cx="${String(last.x)}" cy="${String(last.y)}" r="1.75"/></svg>`;
}

function driverHtml(driver: CockpitDriver): string {
  const text = escapeHtml(driver.candidate ? `Possibly: ${driver.label}` : driver.label);
  const href = safeHref(driver.url);
  const body =
    href === null
      ? text
      : `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  return `<p${driver.kind === 'unknown' ? ' class="unknown"' : ''}>${body}</p>`;
}

function cardHtml(metric: CockpitMetric): string {
  const moved = metric.status === 'improved' || metric.status === 'worse';
  const change =
    moved && metric.delta !== null
      ? `<p class="delta ${metric.status === 'improved' ? 'better' : 'worse'}">${metric.delta > 0 ? '\u25B2' : '\u25BC'} ${escapeHtml(formatDelta(metric.unit, metric.delta))} (${metric.status === 'improved' ? 'better' : 'worse'})</p>`
      : `<p class="note">${escapeHtml(NOTE[metric.status] ?? '')}</p>`;
  const drivers =
    metric.drivers.length === 0
      ? ''
      : `<div class="drivers">${metric.drivers.map(driverHtml).join('')}</div>`;
  return `<li class="card"><div class="card-head"><h3>${escapeHtml(metric.label)}</h3>${sparkline(metric)}</div><p class="value">${escapeHtml(formatValue(metric.unit, metric.value))}</p>${change}${drivers}</li>`;
}

/** The plot, in a 600 x 176 box: bars for what merged, a line for the score beneath them. */
function paceSvg(pace: readonly CockpitPaceWeek[]): string {
  const left = 28;
  const right = 592;
  const barsTop = 8;
  const barsHeight = 64;
  const lineTop = 96;
  const lineHeight = 64;
  const count = Math.max(1, pace.length);
  const step = (right - left) / count;
  const barWidth = round2(step * 0.62);
  const maxMerged = Math.max(1, ...pace.map((week) => week.merged));
  const floor = barsTop + barsHeight;
  const centre = (index: number) => round2(left + step * index + step / 2);
  const parts: string[] = [
    `<line class="grid" x1="${String(left)}" x2="${String(right)}" y1="${String(floor)}" y2="${String(floor)}"/>`,
    `<line class="grid" x1="${String(left)}" x2="${String(right)}" y1="${String(lineTop + lineHeight)}" y2="${String(lineTop + lineHeight)}"/>`,
  ];
  pace.forEach((week, index) => {
    const aiHeight = round2((week.aiAuthored / maxMerged) * barsHeight);
    const otherHeight = round2(((week.merged - week.aiAuthored) / maxMerged) * barsHeight);
    const x = round2(centre(index) - barWidth / 2);
    const group: string[] = [];
    if (otherHeight > 0) {
      group.push(
        `<rect class="bar" x="${String(x)}" y="${String(round2(floor - aiHeight - otherHeight))}" width="${String(barWidth)}" height="${String(otherHeight)}"/>`,
      );
    }
    if (aiHeight > 0) {
      group.push(
        `<rect class="agent" x="${String(x)}" y="${String(round2(floor - aiHeight))}" width="${String(barWidth)}" height="${String(aiHeight)}"/>`,
      );
    }
    if (group.length > 0)
      parts.push(`<g${week.partial ? ' class="partial"' : ''}>${group.join('')}</g>`);
  });
  // The score: joined only across weeks graded by the same formula with no gap between.
  const segments: string[] = [];
  const dots: string[] = [];
  let segment: string[] = [];
  let previous: { x: number; version: number | null } | null = null;
  const flush = () => {
    if (segment.length >= 2) segments.push(segment.join(' '));
    segment = [];
  };
  pace.forEach((week, index) => {
    if (week.score === null) {
      flush();
      previous = null;
      return;
    }
    const x = centre(index);
    const y = round2(lineTop + lineHeight - (week.score / 100) * lineHeight);
    if (previous !== null && previous.version !== week.formulaVersion) {
      flush();
      const at = round2((previous.x + x) / 2);
      parts.push(
        `<line class="break" x1="${String(at)}" x2="${String(at)}" y1="${String(lineTop)}" y2="${String(lineTop + lineHeight)}"/>`,
      );
    }
    segment.push(`${segment.length === 0 ? 'M' : 'L'} ${String(x)} ${String(y)}`);
    dots.push(`<circle class="dot" cx="${String(x)}" cy="${String(y)}" r="2.5"/>`);
    previous = { x, version: week.formulaVersion };
  });
  flush();
  for (const path of segments) parts.push(`<path class="line" d="${path}"/>`);
  parts.push(...dots);
  const first = pace[0];
  const last = pace.at(-1);
  if (first !== undefined) {
    parts.push(
      `<text class="axis" x="${String(left)}" y="170">${escapeHtml(first.weekStart)}</text>`,
    );
  }
  if (last !== undefined) {
    parts.push(
      `<text class="axis" x="${String(right)}" y="170" text-anchor="end">${escapeHtml(last.weekStart)} (this week)</text>`,
    );
  }
  return `<svg viewBox="0 0 600 176" role="img" aria-label="Pull requests merged per week above the score for the same weeks. The table below has the numbers." focusable="false">${parts.join('')}</svg>`;
}

function paceTable(pace: readonly CockpitPaceWeek[]): string {
  const rows = pace
    .map(
      (week) =>
        `<tr><th scope="row">${escapeHtml(week.partial ? `${week.weekStart} (this week)` : week.weekStart)}</th><td>${String(week.merged)}</td><td>${String(week.linesChanged)}</td><td>${week.aiShare === null ? 'none merged' : `${plain(week.aiShare)}%`}</td><td>${week.score === null ? 'not measured' : plain(week.score)}</td></tr>`,
    )
    .join('');
  return `<table><caption>Pull requests merged and score, by week</caption><thead><tr><th scope="col">Week starting</th><th scope="col">Merged</th><th scope="col">Lines changed</th><th scope="col">Written by an agent</th><th scope="col">Score</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function riskHtml(risks: Cockpit['risks']): string {
  if (risks.total === 0) {
    return `<section class="panel" aria-labelledby="risks"><h2 id="risks">Worth a look</h2><p class="note">No pull request matched. This reads pull requests the delivery sync has stored; if there are none, nothing was checked.</p></section>`;
  }
  const rows = risks.items
    .map((item) => {
      const href = safeHref(item.url);
      const name = escapeHtml(`#${String(item.number)} ${item.title}`);
      const link =
        href === null
          ? name
          : `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${name}</a>`;
      return `<li>${link}<br><span class="note">${escapeHtml(item.detail)}</span></li>`;
    })
    .join('');
  const more =
    risks.total > risks.items.length
      ? `<p class="note">Showing the newest ${String(risks.items.length)} of ${String(risks.total)}.</p>`
      : '';
  return `<section class="panel" aria-labelledby="risks"><h2 id="risks">Worth a look</h2><ul class="risks">${rows}</ul>${more}</section>`;
}
export function renderCockpitHtml(cockpit: Cockpit): string {
  const generated = cockpit.generatedAt.slice(0, 16).replace('T', ' ');
  const title = `Cockpit \u00B7 ${cockpit.projectName} \u00B7 ${generated.slice(0, 10)}`;
  const overallLink = safeHref(cockpit.overall.drivers[0]?.url ?? null);
  const scope = [
    cockpit.projectName,
    cockpit.branch,
    WINDOW_LABEL[cockpit.window],
    `generated ${generated} UTC`,
  ]
    .map(escapeHtml)
    .join(' \u00B7 ');
  const hasAgent = cockpit.pace.some((week) => week.aiAuthored > 0);
  const hasBreak = cockpit.formulaBreak !== null;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`,
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${REPORT_STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<header><h1>Cockpit</h1><p class="scope">${scope}</p></header>`,
    `<section class="status tone-${TONE[cockpit.overall.status]}" aria-label="Status"><p class="score">${escapeHtml(formatValue('score', cockpit.overall.score))}</p><p class="headline">${escapeHtml(cockpit.headline)}</p>${overallLink === null ? '' : `<p><a href="${escapeHtml(overallLink)}" target="_blank" rel="noopener noreferrer">See the change</a></p>`}</section>`,
    `<section aria-labelledby="metrics"><h2 id="metrics">Metrics</h2><ul class="metrics">${cockpit.metrics.map(cardHtml).join('')}</ul></section>`,
    riskHtml(cockpit.risks),
    `<section class="panel" aria-labelledby="pace"><h2 id="pace">Pace against quality</h2>${paceSvg(cockpit.pace)}<p class="legend"><span><i class="swatch" style="background:var(--lupin-chart-1)"></i>Merged</span>${hasAgent ? '<span><i class="swatch" style="background:var(--lupin-chart-2)"></i>Written by an agent</span>' : ''}<span><i class="swatch" style="background:var(--lupin-chart-line)"></i>Score</span>${hasBreak ? '<span>Dashed: the scoring formula changed here, so the line is not joined.</span>' : ''}</p>${paceTable(cockpit.pace)}</section>`,
    `<footer class="foot">A snapshot from Lupin, generated ${escapeHtml(generated)} UTC. It does not update, makes no network requests and runs no script.</footer>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
