import {
  COCKPIT_RISK_ITEMS,
  type CockpitRiskItem,
  type CockpitRiskKind,
  type CockpitRisks,
} from '@lupin/shared-contracts';

/**
 * Pull requests worth a human look, stated as facts the delivery sync already stored.
 *
 * Pure, and deliberately not a score: three yes/no statements per pull request, each checkable
 * on GitHub. A weighted risk number would have to be invented, and an invented number is exactly
 * what the cockpit declines to show. A pull request whose authorship could not be attributed is
 * never counted as AI.
 *
 * In scope: pull requests merged into the shown branch in the last {@link RISK_LOOKBACK_DAYS}
 * days, and open pull requests that are not drafts. Closed-unmerged ones changed nothing.
 */

export const RISK_LOOKBACK_DAYS = 14;
/** Lines added plus deleted at or above which a change with no test file is flagged. */
export const LARGE_CHANGE_LINES = 400;
const MAX_TITLE = 120;
const DAY_MS = 86_400_000;

export interface CockpitRiskPullRequest {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  baseBranch: string | null;
  openedAt: Date;
  mergedAt: Date | null;
  additions: number;
  deletions: number;
  testsTouched: boolean;
  /** Distinct approvers who are neither the author nor a bot. */
  humanApprovalCount: number;
  attribution: string;
}

export interface RiskInputs {
  pullRequests: readonly CockpitRiskPullRequest[];
  branch: string;
  now: Date;
  repository: { owner: string; repo: string } | null;
}

const truncate = (text: string): string =>
  text.length <= MAX_TITLE ? text : `${text.slice(0, MAX_TITLE - 1)}…`;

const isAi = (attribution: string): boolean =>
  attribution === 'agent-authored' || attribution === 'ai-assisted';

/** The time the pull request counts from, or `null` when it is out of scope. */
function scopedAt(pr: CockpitRiskPullRequest, branch: string, floor: Date): Date | null {
  if (pr.state === 'merged' && pr.mergedAt !== null) {
    return pr.baseBranch === branch && pr.mergedAt.getTime() >= floor.getTime()
      ? pr.mergedAt
      : null;
  }
  return pr.state === 'open' && !pr.draft ? pr.openedAt : null;
}

function kindsOf(pr: CockpitRiskPullRequest): Array<[CockpitRiskKind, string]> {
  const merged = pr.state === 'merged';
  const lines = pr.additions + pr.deletions;
  const found: Array<[CockpitRiskKind, string]> = [];
  if (lines >= LARGE_CHANGE_LINES && !pr.testsTouched) {
    found.push([
      'large_change_without_tests',
      `${String(lines)} lines changed and no test file among them.`,
    ]);
  }
  if (merged && pr.humanApprovalCount === 0) {
    found.push(['merged_without_human_approval', 'Merged with no approval from a person.']);
  }
  if (!merged && isAi(pr.attribution) && pr.humanApprovalCount === 0) {
    found.push([
      'ai_change_awaiting_human',
      `Attributed as ${pr.attribution === 'agent-authored' ? 'written by an agent' : 'AI-assisted'} and not yet approved by a person.`,
    ]);
  }
  return found;
}

export function riskSignals(inputs: RiskInputs): CockpitRisks {
  const floor = new Date(inputs.now.getTime() - RISK_LOOKBACK_DAYS * DAY_MS);
  const repository = inputs.repository;
  const items: CockpitRiskItem[] = [];
  for (const pr of inputs.pullRequests) {
    const at = scopedAt(pr, inputs.branch, floor);
    if (at === null) continue;
    for (const [kind, detail] of kindsOf(pr)) {
      items.push({
        kind,
        number: pr.number,
        title: truncate(pr.title),
        url:
          repository === null
            ? null
            : `https://github.com/${repository.owner}/${repository.repo}/pull/${String(pr.number)}`,
        detail,
        at: at.toISOString(),
      });
    }
  }
  items.sort((left, right) => right.at.localeCompare(left.at) || left.number - right.number);
  return { total: items.length, items: items.slice(0, COCKPIT_RISK_ITEMS) };
}
