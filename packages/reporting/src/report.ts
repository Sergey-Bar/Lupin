import type { Briefing, DigestItem, ScorecardStatus } from '@lupin/shared-contracts';

/**
 * The scheduled report: one model, read in five seconds, rendered for five chat platforms.
 *
 * The shape is the point and it is fixed: a status you can see before you read (🟢 🟡 🔴),
 * one sentence, at most three items worst first, how many more there are, one line per area
 * (DORA, AI-written code, agent quality — at most three), the top three actions across every
 * area, and one link.
 * Anything longer is a report that is skimmed on Monday and muted by Wednesday, which is
 * the failure a daily digest exists to avoid — and it is the same shape the dashboard's
 * "Now" page uses, so the message and the page agree.
 *
 * Pure: no clock, no I/O, no transport. The renderers below are pure too, and each one
 * escapes for its platform and fits its platform's length limit, which
 * `report.property.test.ts` states as DIGEST-1 and DIGEST-2.
 */

export type ReportStatus = 'good' | 'caution' | 'bad';

/** Something that needs a person: a failing run, a grade that dropped, a broken delivery. */
export interface AttentionItem {
  severity: 'bad' | 'caution';
  text: string;
}

export interface ReportInput {
  /** What the report is about: "Weekly quality report", or a subscription's own name. */
  title: string;
  runs: number;
  /** 0–100, or null when nothing ran. */
  passRate: number | null;
  attention: readonly AttentionItem[];
  digest: readonly DigestItem[];
  /** The dashboard. Only an http(s) URL is ever linked. */
  link: string | null;
  /** One line each, in order: DORA, AI-written code, agent quality. At most three are shown. */
  areas?: readonly ReportArea[];
  /** Scorecards with no line of their own (supply chain, test effectiveness): reasons only. */
  scorecards?: readonly ReportCard[];
  /** Every project's grade fix-next items, each with the points fixing it is worth. */
  fixNext?: readonly ReportFix[];
  /** The cockpit's headline and what moved. Absent when the workspace has no project to read. */
  cockpit?: ReportCockpit;
  /** What happened over the period, from the briefing. Absent: no briefing block. */
  briefing?: ReportBriefing;
}

/** The briefing, as the digest carries it: its headline and its few worst lines. */
export interface ReportBriefing {
  headline: string;
  /** At most {@link MAX_BRIEFING_LINES}, worst first. */
  lines: readonly ReportLine[];
}

/** One project's scorecard in one area, as the digest reads it: verdict, score and why. */
export interface ReportCard {
  project: string;
  status: ScorecardStatus;
  /** 0–100, or 
ull while unmeasured. */
  score: number | null;
  reasons: readonly string[];
}

export interface ReportArea {
  /** "DORA", "AI code", "Agent quality". */
  label: string;
  cards: readonly ReportCard[];
}

export interface ReportFix {
  project: string;
  title: string;
  /** Points of overall score fixing it is worth. */
  gain: number;
}

/**
 * The cockpit's answer, for the head of the digest: whether the product is better or worse
 * than it was, in the cockpit's own sentence, and the few things that moved.
 */
export interface ReportCockpit {
  /** "Down 6 points since last week, mostly lower coverage and more flaky tests." */
  headline: string;
  /** `bad` when the score fell, `good` when it rose or held, `caution` when it cannot be compared. */
  tone: 'bad' | 'caution' | 'good';
  /** The metrics that moved most, at most {@link MAX_CHANGES}, one line each. */
  changes: readonly ReportLine[];
}

export interface ReportLine {
  /** `neutral` is news that is neither good nor bad, such as a change in the run count. */
  tone: 'bad' | 'caution' | 'neutral' | 'good';
  text: string;
}

export interface ReportModel {
  status: ReportStatus;
  emoji: string;
  title: string;
  sentence: string;
  /** At most {@link MAX_ITEMS}, worst first. */
  items: ReportLine[];
  /** How many lines did not fit in {@link MAX_ITEMS}. */
  more: number;
  /** At most {@link MAX_AREAS}: one line per area, in the order the input gave them. */
  areas: ReportLine[];
  /** At most {@link MAX_ACTIONS}: the grade's best fixes first, then failing scorecards' reasons. */
  actions: string[];
  /** The cockpit's headline and changes, led with; `null` when there is none. */
  cockpit: { headline: string; tone: ReportCockpit['tone']; changes: ReportLine[] } | null;
  /** The briefing's headline and worst lines, after the cockpit; `null` when there is none. */
  briefing: { headline: string; lines: ReportLine[] } | null;
  link: string | null;
}

export const MAX_ITEMS = 3;
export const MAX_AREAS = 3;
export const MAX_ACTIONS = 3;
export const MAX_CHANGES = 3;
export const MAX_BRIEFING_LINES = 3;

/**
 * The briefing's part of a digest: its headline, and the lines that need someone (what got
 * riskier, what needs a decision, anything bad or cautionary) worst first. Its plain notes
 * (what merged, what deployed) are already in the headline.
 */
export function reportBriefingOf(briefing: Briefing): ReportBriefing {
  const lines = briefing.items
    .filter((item) => item.tone === 'bad' || item.tone === 'caution')
    .map((item, order) => ({ line: { tone: item.tone, text: item.text }, order }))
    .sort((a, b) => TONE_RANK[a.line.tone] - TONE_RANK[b.line.tone] || a.order - b.order)
    .slice(0, MAX_BRIEFING_LINES)
    .map(({ line }) => line);
  return { headline: briefing.headline, lines };
}

const EMOJI: Record<ReportStatus, string> = { good: '🟢', caution: '🟡', bad: '🔴' };
const TONE_RANK: Record<ReportLine['tone'], number> = { bad: 0, caution: 1, neutral: 2, good: 3 };

function safeLink(link: string | null): string | null {
  if (link === null) return null;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function sentenceFor(input: ReportInput): string {
  if (input.runs === 0) return 'Nothing ran in this period.';
  const runs = `${String(input.runs)} run${input.runs === 1 ? '' : 's'}`;
  return input.passRate === null
    ? `${runs} in this period.`
    : `${String(Math.round(input.passRate * 10) / 10)}% passed across ${runs}.`;
}

const scoreText = (score: number | null) => (score === null ? 'unscored' : score.toFixed(0));

/** The card a reader should look at first: failing before passing, then the lowest score. */
function worstCard(cards: readonly ReportCard[]): ReportCard | undefined {
  const rank = (card: ReportCard) => (card.status === 'fail' ? 0 : 1);
  return [...cards].sort((a, b) => rank(a) - rank(b) || (a.score ?? 101) - (b.score ?? 101))[0];
}

/** "DORA: 1 of 3 failing — checkout 42", or `not measured yet` when no card was measured. */
export function areaLine(area: ReportArea): ReportLine {
  const measured = area.cards.filter((card) => card.status === 'pass' || card.status === 'fail');
  const worst = worstCard(measured);
  if (worst === undefined) return { tone: 'neutral', text: `${area.label}: not measured yet` };
  const failing = measured.filter((card) => card.status === 'fail').length;
  const weakest = `${worst.project} ${scoreText(worst.score)}`;
  return failing > 0
    ? {
        tone: 'bad',
        text: `${area.label}: ${String(failing)} of ${String(measured.length)} failing — ${weakest}`,
      }
    : {
        tone: 'good',
        text: `${area.label}: ${String(measured.length)} passing, lowest ${weakest}`,
      };
}

/**
 * The top actions across every area: the grade's fixes by the points they are worth, then
 * each failing scorecard's reasons, the lowest-scoring card first. The same sentence from
 * two places is listed once.
 */
export function topActions(input: ReportInput): string[] {
  const fixes = [...(input.fixNext ?? [])]
    .filter((fix) => Number.isFinite(fix.gain))
    .sort((a, b) => b.gain - a.gain)
    .map((fix) => `${fix.project}: ${fix.title} (+${fix.gain.toFixed(1)} pts)`);
  const failing = [
    ...(input.areas ?? []).flatMap((area) => area.cards),
    ...(input.scorecards ?? []),
  ]
    .filter((card) => card.status === 'fail')
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  const reasons = failing.flatMap((card) =>
    card.reasons.map((reason) => `${card.project}: ${reason}`),
  );
  return [...new Set([...fixes, ...reasons])].slice(0, MAX_ACTIONS);
}

export function composeReport(input: ReportInput): ReportModel {
  const lines: ReportLine[] = [
    ...input.attention.map((item) => ({ tone: item.severity, text: item.text })),
    ...input.digest.map((item) => ({ tone: item.tone, text: item.text })),
  ]
    .map((line, order) => ({ line, order }))
    .sort((a, b) => TONE_RANK[a.line.tone] - TONE_RANK[b.line.tone] || a.order - b.order)
    .map(({ line }) => line);
  const areas = (input.areas ?? [])
    .filter((area) => area.cards.length > 0)
    .slice(0, MAX_AREAS)
    .map(areaLine);
  const cockpit =
    input.cockpit === undefined
      ? null
      : {
          headline: input.cockpit.headline,
          tone: input.cockpit.tone,
          changes: input.cockpit.changes.slice(0, MAX_CHANGES).map((line) => ({ ...line })),
        };
  // A fall in the score is never a green report, and a score that cannot be compared is not
  // a pass either; but only an item that needs someone makes it red.
  const cockpitLines: ReportLine[] =
    cockpit === null
      ? []
      : [{ tone: cockpit.tone === 'good' ? 'good' : 'caution', text: cockpit.headline }];
  const briefing =
    input.briefing === undefined
      ? null
      : {
          headline: input.briefing.headline,
          lines: input.briefing.lines.slice(0, MAX_BRIEFING_LINES).map((line) => ({ ...line })),
        };
  // The briefing's lines can make a report yellow, never red: red is for an item that
  // needs someone now, and the briefing reports what already happened.
  const briefingLines = briefing?.lines ?? [];
  const status: ReportStatus = input.attention.some((item) => item.severity === 'bad')
    ? 'bad'
    : [...lines, ...areas, ...cockpitLines, ...briefingLines].some(
          (line) => line.tone === 'bad' || line.tone === 'caution',
        )
      ? 'caution'
      : 'good';
  return {
    status,
    emoji: EMOJI[status],
    title: input.title,
    sentence: sentenceFor(input),
    items: lines.slice(0, MAX_ITEMS),
    more: Math.max(0, lines.length - MAX_ITEMS),
    areas,
    actions: topActions(input),
    cockpit,
    briefing,
    link: safeLink(input.link),
  };
}

/** Each platform's own ceiling for one message, in characters. */
export const PLATFORM_LIMITS = {
  // Slack truncates a message's `text` past 40,000 and recommends staying under 4,000.
  slack: 3_000,
  // Telegram's hard limit for `sendMessage` text, counted after entity parsing.
  telegram: 4_096,
  // A WhatsApp template's body parameter, and a Signal message that stays one bubble.
  plain: 1_024,
  // One Adaptive Card TextBlock; the card itself is far larger.
  teamsBlock: 1_000,
} as const;

const BULLET: Record<ReportLine['tone'], string> = {
  bad: '🔴',
  caution: '🟡',
  neutral: '•',
  good: '🟢',
};

function moreText(model: ReportModel): string | null {
  return model.more === 0 ? null : `+${String(model.more)} more`;
}

/**
 * Lines escaped for a platform, kept whole while they fit, and the first line that does not
 * fit trimmed on the *raw* text, so an entity such as `&amp;` is never cut in half.
 */
function fit(lines: readonly string[], escape: (raw: string) => string, budget: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const raw of lines) {
    const separator = kept.length === 0 ? 0 : 1;
    const escaped = escape(raw);
    if (used + separator + escaped.length <= budget) {
      kept.push(escaped);
      used += separator + escaped.length;
      continue;
    }
    const room = budget - used - separator;
    let cut = raw;
    while (cut.length > 0 && escape(`${cut}…`).length > room) cut = cut.slice(0, -1);
    if (cut.length > 0) kept.push(escape(`${cut}…`));
    break;
  }
  return kept.join('\n');
}

function plainLines(model: ReportModel): [string, ...string[]] {
  const more = moreText(model);
  return [
    `${model.emoji} ${model.title}`,
    // The cockpit leads: whether the product is better or worse than it was is the news,
    // and a platform's limit cuts the lines under it before it cuts this.
    ...(model.cockpit === null
      ? []
      : [
          model.cockpit.headline,
          ...model.cockpit.changes.map((change) => `${BULLET[change.tone]} ${change.text}`),
        ]),
    // What happened while nobody was looking, after whether it is better or worse.
    ...(model.briefing === null
      ? []
      : [
          `While you were away: ${model.briefing.headline}`,
          ...model.briefing.lines.map((line) => `${BULLET[line.tone]} ${line.text}`),
        ]),
    model.sentence,
    ...model.items.map((item) => `${BULLET[item.tone]} ${item.text}`),
    ...(more === null ? [] : [more]),
    // The actions before the area lines: when a platform's limit cuts, it cuts the summary of
    // what is fine before it cuts what to do.
    ...(model.actions.length === 0 ? [] : ['Top actions:']),
    ...model.actions.map((action, index) => `${String(index + 1)}. ${action}`),
    ...model.areas.map((area) => `${BULLET[area.tone]} ${area.text}`),
  ];
}

/** WhatsApp and Signal: no markup at all, so nothing to escape. */
export function renderPlain(model: ReportModel, limit: number = PLATFORM_LIMITS.plain): string {
  const linkLine = model.link === null ? null : model.link;
  const budget = linkLine === null ? limit : limit - linkLine.length - 1;
  const body = fit(plainLines(model), (raw) => raw, Math.max(0, budget));
  return linkLine === null || linkLine.length + 1 > limit ? body : `${body}\n${linkLine}`;
}

/** Telegram, `parse_mode: HTML`: only `&`, `<` and `>` need escaping in text. */
export function escapeTelegramHtml(raw: string): string {
  return raw.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

export function renderTelegram(
  model: ReportModel,
  limit: number = PLATFORM_LIMITS.telegram,
): string {
  const linkHtml =
    model.link === null
      ? null
      : `<a href="${escapeTelegramHtml(model.link).replace(/"/gu, '&quot;')}">Open the dashboard</a>`;
  const reserved = linkHtml === null ? 0 : linkHtml.length + 1;
  const [first, ...rest] = plainLines(model);
  const head = `<b>${fit([first], escapeTelegramHtml, Math.max(0, limit - reserved - 7))}</b>`;
  const body = fit(rest, escapeTelegramHtml, Math.max(0, limit - reserved - head.length - 1));
  const text = body === '' ? head : `${head}\n${body}`;
  return linkHtml === null || text.length + reserved > limit ? text : `${text}\n${linkHtml}`;
}

/** Slack `mrkdwn`: `&`, `<` and `>` are the characters Slack documents as control. */
export function escapeSlack(raw: string): string {
  return escapeTelegramHtml(raw);
}

export function renderSlack(model: ReportModel, limit: number = PLATFORM_LIMITS.slack): string {
  // `<url|label>`: a URL may not carry the two characters that end the link.
  const linkText =
    model.link === null
      ? null
      : `<${model.link.replace(/\|/gu, '%7C').replace(/>/gu, '%3E').replace(/</gu, '%3C')}|Open the dashboard>`;
  const reserved = linkText === null ? 0 : linkText.length + 1;
  const [first, ...rest] = plainLines(model);
  const head = `*${fit([first], escapeSlack, Math.max(0, limit - reserved - 2))}*`;
  const body = fit(rest, escapeSlack, Math.max(0, limit - reserved - head.length - 1));
  const text = body === '' ? head : `${head}\n${body}`;
  return linkText === null || text.length + reserved > limit ? text : `${text}\n${linkText}`;
}

/** The Adaptive Card a Teams Workflows webhook posts, as the message `attachments` entry. */
export interface TeamsMessage {
  type: 'message';
  attachments: Array<{
    contentType: 'application/vnd.microsoft.card.adaptive';
    content: Record<string, unknown>;
  }>;
}

/**
 * A picture for the card, as a `data:` address: a Teams webhook cannot be handed a file, and a
 * public address would mean putting a local install on the internet to show a chart.
 */
export interface TeamsImage {
  /** `data:image/png;base64,…`. */
  dataUri: string;
  alt: string;
}

/**
 * The most a card's picture may weigh as a data address. A Workflows message is limited to
 * about 28 KB in all, and the text of a full digest can take half of it, so a larger picture
 * is left out rather than risk the whole card being refused.
 */
export const TEAMS_IMAGE_MAX_CHARS = 8_000;

/**
 * Teams. The card is data rather than markup, so there is nothing to escape; each text block
 * is plain (`wrap`, no markdown) and kept under {@link PLATFORM_LIMITS.teamsBlock}.
 *
 * With an `image` the chart sits under the title. Whether Teams draws a data address in a
 * card has not been checked against a tenant, which is why the picture comes with its text
 * beside it and a card without one is a complete message.
 */
export function renderTeams(model: ReportModel, image?: TeamsImage): TeamsMessage {
  const block = (text: string, extra: Record<string, unknown> = {}) => ({
    type: 'TextBlock',
    text: fit([text], (raw) => raw, PLATFORM_LIMITS.teamsBlock),
    wrap: true,
    ...extra,
  });
  const [title, ...body] = plainLines(model);
  const picture =
    image !== undefined &&
    image.dataUri.startsWith('data:image/png;base64,') &&
    image.dataUri.length <= TEAMS_IMAGE_MAX_CHARS
      ? [{ type: 'Image', url: image.dataUri, altText: image.alt, size: 'Stretch' }]
      : [];
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            block(title, { size: 'Large', weight: 'Bolder' }),
            ...picture,
            ...body.map((line) => block(line)),
          ],
          ...(model.link === null
            ? {}
            : {
                actions: [{ type: 'Action.OpenUrl', title: 'Open the dashboard', url: model.link }],
              }),
        },
      },
    ],
  };
}
