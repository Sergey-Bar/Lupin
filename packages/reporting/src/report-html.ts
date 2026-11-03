import { REPORT_STYLE, escapeHtml, safeHref } from './cockpit-html.js';
import type { ReportLine, ReportModel } from './report.js';

/**
 * The scheduled report as one self-contained HTML page — the `full` format.
 *
 * It renders the *same* {@link ReportModel} the chat digest renders, so the full report and the
 * five chat messages are the same truth in a richer layout: the status, the cockpit headline
 * and what moved, the sentence, the model's items, its area lines and its actions, each in its
 * own titled section rather than squeezed into one message. The model is already composed and
 * capped by {@link composeReport} and ordered by the lens, so a manager's full report leads with
 * delivery exactly as their digest does; what `full` adds over `chat` is the layout and the
 * sections a chat length limit would drop, not more rows than the model carries.
 *
 * It is built with the same guarantees as the cockpit HTML it borrows its style from:
 *
 * - **Nothing is fetched.** A `Content-Security-Policy` in the page forbids script, image,
 *   font, frame and form; the only addresses are `https://` links in `<a>` elements.
 * - **Every value is escaped**, through {@link escapeHtml}, and a link is followed only if it is
 *   `https:` (via {@link safeHref}).
 * - **It is deterministic**: the only variable is the model, so the same model is the same bytes
 *   and a CI artifact does not change when nothing did.
 *
 * The colours are the product's tokens in both themes, shared with the cockpit page through
 * `REPORT_STYLE`, so `cockpit-html.test.ts`'s token-drift check covers this page too.
 */

const TONE_CLASS: Record<ReportLine['tone'], string> = {
  bad: 'tone-bad',
  caution: 'tone-caution',
  neutral: 'tone-neutral',
  good: 'tone-good',
};

const STATUS_WORD: Record<ReportModel['status'], string> = {
  good: 'Good',
  caution: 'Needs a decision',
  bad: 'Needs attention',
};

function lineItems(lines: readonly ReportLine[]): string {
  return lines
    .map((line) => `<li class="line ${TONE_CLASS[line.tone]}">${escapeHtml(line.text)}</li>`)
    .join('');
}

function section(title: string, body: string): string {
  return body === ''
    ? ''
    : `<section class="panel" aria-labelledby="${escapeHtml(title.toLowerCase().replace(/[^a-z]+/gu, '-'))}"><h2 id="${escapeHtml(title.toLowerCase().replace(/[^a-z]+/gu, '-'))}">${escapeHtml(title)}</h2>${body}</section>`;
}

export interface FullReportOptions {
  /** When the report was generated, ISO; the only time in the page, so it stays deterministic. */
  generatedAt: string;
  /** The workspace or installation the report is about, shown in the scope line. */
  scope?: string;
}

export function renderFullReport(model: ReportModel, options: FullReportOptions): string {
  const generated = options.generatedAt.slice(0, 16).replace('T', ' ');
  const scopeParts = [options.scope, `generated ${generated} UTC`].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  const link = safeHref(model.link);
  const cockpit =
    model.cockpit === null
      ? ''
      : `<section class="status tone-${model.cockpit.tone === 'good' ? 'good' : model.cockpit.tone === 'bad' ? 'bad' : 'caution'}" aria-label="Headline"><p class="headline">${escapeHtml(model.cockpit.headline)}</p></section>${section('What moved', model.cockpit.changes.length === 0 ? '' : `<ul class="lines">${lineItems(model.cockpit.changes)}</ul>`)}`;
  const items = section(
    'Needs a person',
    model.items.length === 0
      ? '<p class="note">Nothing needs a person in this window.</p>'
      : `<ul class="lines">${lineItems(model.items)}</ul>`,
  );
  const areas = section(
    'Areas',
    model.areas.length === 0 ? '' : `<ul class="lines">${lineItems(model.areas)}</ul>`,
  );
  const actions = section(
    'Top actions',
    model.actions.length === 0
      ? ''
      : `<ol class="actions">${model.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ol>`,
  );
  const open =
    link === null
      ? ''
      : `<p><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open the dashboard</a></p>`;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`,
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(model.title)}</title>`,
    `<style>${REPORT_STYLE}.lines,.actions{margin:0;padding:0 0 0 1.25rem}.lines{list-style:none;padding:0}.line{border-top:1px solid var(--lupin-border);padding:.375rem 0;font-size:.9375rem}.line:first-child{border-top:0}.line.tone-bad{color:var(--lupin-danger)}.line.tone-caution{color:var(--lupin-warning)}.line.tone-good{color:var(--lupin-success)}.actions li{padding:.25rem 0}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<header><h1>${escapeHtml(model.title)}</h1><p class="scope">${escapeHtml(STATUS_WORD[model.status])} \u00B7 ${scopeParts.map(escapeHtml).join(' \u00B7 ')}</p><p class="headline">${escapeHtml(model.sentence)}</p>${open}</header>`,
    cockpit,
    items,
    areas,
    actions,
    `<footer class="foot">A report from Lupin, generated ${escapeHtml(generated)} UTC. It does not update, makes no network requests and runs no script.</footer>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
