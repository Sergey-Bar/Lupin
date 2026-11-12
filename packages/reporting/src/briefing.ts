import type {
  Briefing,
  BriefingItem,
  BriefingScope,
  BriefingSectionId,
  ChangeRiskLevel,
  Shape,
} from '@lupin/shared-contracts';

/**
 * What happened while nobody was looking: a briefing for one repository or the portfolio.
 *
 * Pure and deterministic. Every item is a sentence built from one count this function was given,
 * names where the count was read from, and lands in one of five sections: the shape (pace and
 * where changes are stuck), what shipped, what got riskier, how quality moved, and what needs a
 * decision. Only what happened becomes a line; a window where nothing did is one line saying so,
 * and never a list of zeros (BRIEF-1, BRIEF-2).
 */

export const BRIEFING_VERSION = 'briefing/1';
export const MAX_BOTTLENECKS = 3;
export const MAX_DECISIONS = 5;

export interface BriefingDecision {
  projectId: string;
  projectName: string;
  number: number;
  title: string;
  level: ChangeRiskLevel;
  score: number;
}

export interface BriefingInput {
  scope: BriefingScope;
  now: Date;
  windowDays: number;
  /** Merged in the window; `null` when no delivery sync has read any pull request. */
  merged: {
    total: number;
    ai: number;
    highRisk: number;
    unreviewedAi: number;
    tampered: number;
  } | null;
  /** Production deployments in the window; `null` when none are read here. */
  deployments: number | null;
  pace: {
    changedLines: number;
    testsPerKloc: number | null;
    debt: number;
    unmeasured: number;
  } | null;
  bottlenecks: ReadonlyArray<{ projectId: string; projectName: string; sentence: string }>;
  /** The cockpit's own sentence about how quality moved; `null` when it cannot be read. */
  quality: { headline: string; tone: 'good' | 'caution' | 'bad' } | null;
  /** Open changes assessed high or critical at their head, worst first. */
  decisions: readonly BriefingDecision[];
}

const n = (value: number) => Math.max(0, Math.floor(value)).toLocaleString('en-US');
const plural = (count: number, one: string, many: string) =>
  `${n(count)} ${count === 1 ? one : many}`;

type Draft = Omit<BriefingItem, 'section'>;

function item(section: BriefingSectionId, draft: Draft): BriefingItem {
  return { ...draft, section };
}

function scopeKey(scope: BriefingScope): string {
  return scope.kind === 'repository' ? `project:${scope.projectId}` : 'portfolio';
}

/** The pull-request list, narrowed to the repository when the briefing is about one. */
function pullRequestsLink(scope: BriefingScope): string {
  return scope.kind === 'repository'
    ? `/dashboard/prs?project=${encodeURIComponent(scope.projectId)}`
    : '/dashboard/prs';
}

function shapeItems(input: BriefingInput): BriefingItem[] {
  const items: BriefingItem[] = [];
  const pace = input.pace;
  if (pace !== null && pace.changedLines > 0) {
    const tests =
      pace.testsPerKloc === null
        ? 'new tests not measured'
        : `${String(pace.testsPerKloc)} new tests per 1,000 lines`;
    const unmeasured =
      pace.unmeasured > 0 ? `, ${n(pace.unmeasured)} with coverage not measured` : '';
    items.push(
      item('shape', {
        id: 'shape.pace',
        tone: pace.debt > 0 || pace.unmeasured > 0 ? 'caution' : 'good',
        text: `${n(pace.changedLines)} lines changed, ${tests}; ${n(pace.debt)} untested changed lines merged${unmeasured}.`,
        evidence: [`pace:${scopeKey(input.scope)}`],
        link:
          input.scope.kind === 'repository'
            ? `/dashboard/repo/${input.scope.projectId}/overview`
            : null,
      }),
    );
  }
  input.bottlenecks.slice(0, MAX_BOTTLENECKS).forEach((entry, index) => {
    items.push(
      item('shape', {
        id: `shape.bottleneck-${String(index + 1)}`,
        tone: 'caution',
        text:
          input.scope.kind === 'portfolio'
            ? `${entry.projectName}: ${entry.sentence}`
            : entry.sentence,
        evidence: [`phases:project:${entry.projectId}`],
        link: `/dashboard/repo/${entry.projectId}/overview`,
      }),
    );
  });
  return items;
}

function shippedItems(input: BriefingInput): BriefingItem[] {
  if (input.merged === null) {
    return [
      item('shipped', {
        id: 'shipped.not-synced',
        tone: 'neutral',
        text: 'Nothing merged is known: turn on delivery sync.',
        evidence: ['delivery-sync:off'],
        link: null,
      }),
    ];
  }
  const items: BriefingItem[] = [];
  const window = `${scopeKey(input.scope)}:${String(input.windowDays)}d`;
  if (input.merged.total > 0) {
    items.push(
      item('shipped', {
        id: 'shipped.merged',
        tone: 'neutral',
        text: `${plural(input.merged.total, 'pull request', 'pull requests')} merged, ${n(input.merged.ai)} AI-written.`,
        evidence: [`pull-requests:merged:${window}`],
        link: pullRequestsLink(input.scope),
      }),
    );
  }
  if (input.deployments !== null && input.deployments > 0) {
    items.push(
      item('shipped', {
        id: 'shipped.deployments',
        tone: 'neutral',
        text: `${plural(input.deployments, 'deployment', 'deployments')} to production.`,
        evidence: [`deployments:${window}`],
        link: '/dashboard/delivery',
      }),
    );
  }
  return items;
}

function riskierItems(input: BriefingInput): BriefingItem[] {
  const merged = input.merged;
  if (merged === null) return [];
  const window = `${scopeKey(input.scope)}:${String(input.windowDays)}d`;
  const lines: Array<[string, number, string, string]> = [
    [
      'riskier.high-risk',
      merged.highRisk,
      `${n(merged.highRisk)} merged at high risk or above.`,
      'risk-assessments',
    ],
    [
      'riskier.unreviewed-ai',
      merged.unreviewedAi,
      `${n(merged.unreviewedAi)} AI-written merged with no person approving.`,
      'pull-requests:unreviewed-ai',
    ],
    [
      'riskier.tampered',
      merged.tampered,
      `${n(merged.tampered)} merged with changes that weakened ${merged.tampered === 1 ? 'its' : 'their'} tests.`,
      'diff-guard',
    ],
  ];
  return lines
    .filter(([, count]) => count > 0)
    .map(([id, , text, source]) =>
      item('riskier', {
        id,
        tone: 'bad',
        text,
        evidence: [`${source}:${window}`],
        link: pullRequestsLink(input.scope),
      }),
    );
}

function qualityItems(input: BriefingInput): BriefingItem[] {
  if (input.quality === null) return [];
  return [
    item('quality', {
      id: 'quality.cockpit',
      tone: input.quality.tone,
      text: input.quality.headline,
      evidence: [`cockpit:${scopeKey(input.scope)}:7d`],
      link: '/dashboard/now',
    }),
  ];
}

function decisionItems(input: BriefingInput): BriefingItem[] {
  // One line per pull request, keyed on its whole project id, so two repositories never share one.
  const seen = new Set<string>();
  const unique = input.decisions.filter((decision) => {
    const key = `${decision.projectId.toLowerCase()}-${String(decision.number)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, MAX_DECISIONS).map((decision) => {
    const who = input.scope.kind === 'portfolio' ? `${decision.projectName} ` : '';
    return item('decide', {
      id: `decide.pr-${decision.projectId.toLowerCase()}-${String(decision.number)}`,
      tone: decision.level === 'critical' ? 'bad' : 'caution',
      text: `${who}#${String(decision.number)} ${decision.title}: ${decision.level} risk, ${String(decision.score)} points, still open.`.slice(
        0,
        300,
      ),
      evidence: [`pull-request:${decision.projectId}:${String(decision.number)}`],
      link: `/dashboard/prs/${decision.projectId}/${String(decision.number)}`,
    });
  });
}

function shapeOf(items: readonly BriefingItem[]): Shape {
  const tones = items.map((entry) => entry.tone);
  if (tones.includes('bad')) return 'bad';
  if (tones.includes('caution')) return 'caution';
  return tones.includes('good') ? 'good' : 'unknown';
}

const clause = (text: string) => text.replace(/\.$/u, '');

function headlineOf(items: readonly BriefingItem[]): string {
  const merged = items.find(
    (entry) => entry.id === 'shipped.merged' || entry.id === 'shipped.not-synced',
  );
  const risk = items.find((entry) => entry.section === 'riskier');
  const stuck = items.find((entry) => entry.id.startsWith('shape.bottleneck'));
  const parts = [merged, risk, stuck].flatMap((entry) =>
    entry === undefined ? [] : [clause(entry.text)],
  );
  return parts.length === 0
    ? (items[0]?.text ?? 'Nothing happened.')
    : `${parts.join('; ')}.`.slice(0, 400);
}

export function composeBriefing(input: BriefingInput): Briefing {
  const windowDays = Math.min(366, Math.max(1, Math.floor(input.windowDays)));
  const found = [
    ...shapeItems(input),
    ...shippedItems(input),
    ...riskierItems(input),
    ...qualityItems(input),
    ...decisionItems(input),
  ];
  const items =
    found.length > 0
      ? found
      : [
          item('shape', {
            id: 'shape.quiet',
            tone: 'neutral',
            text: `Nothing happened in the last ${plural(windowDays, 'day', 'days')}.`,
            evidence: [`window:${String(windowDays)}d`],
            link: null,
          }),
        ];
  return {
    version: BRIEFING_VERSION,
    scope: input.scope,
    windowDays,
    generatedAt: input.now.toISOString(),
    shape: shapeOf(items),
    headline: headlineOf(items),
    items,
  };
}
