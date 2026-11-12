import {
  changeRiskRank,
  type ChangeRiskLevel,
  type GithubPullItem,
  type PullRequestRisk,
} from '@lupin/shared-contracts';
import type { HeroVerdict } from '@lupin/ui';

/**
 * How a pull request's change risk reads on screen: its word, its badge, its status band, and
 * the attention item a high one earns on Home.
 *
 * Pure, and nothing here invents: every sentence is one the assessment wrote, and a level the
 * gate never measured reads "Risk unknown" with what was missing, never as low.
 */

export const RISK_WORD: Readonly<Record<ChangeRiskLevel, string>> = {
  low: 'Low risk',
  medium: 'Medium risk',
  unknown: 'Risk unknown',
  high: 'High risk',
  critical: 'Critical risk',
};

/** A `Badge` variant per level. Unknown is neutral: not measured is not safe, and not red. */
export const RISK_BADGE: Readonly<
  Record<ChangeRiskLevel, 'danger' | 'warning' | 'success' | 'secondary'>
> = {
  low: 'success',
  medium: 'warning',
  unknown: 'secondary',
  high: 'danger',
  critical: 'danger',
};

const VERDICT: Readonly<Record<ChangeRiskLevel, HeroVerdict>> = {
  low: 'go',
  medium: 'caution',
  unknown: 'unknown',
  high: 'no-go',
  critical: 'no-go',
};

/** The evidence names the API uses, as a reader says them. */
export const EVIDENCE_LABEL: Readonly<Record<string, string>> = {
  tests: 'test results',
  'diff-coverage': 'diff coverage',
  attribution: 'who wrote it',
  findings: 'a security scan',
  tampering: 'a diff-guard check',
  evals: 'eval results',
};

export function isHighRisk(level: ChangeRiskLevel): boolean {
  return changeRiskRank(level) >= changeRiskRank('high');
}

/** The status band: the level's word, and the one sentence that explains it. */
export function riskHero(assessed: PullRequestRisk): {
  verdict: HeroVerdict;
  word: string;
  reason: string;
} {
  const { level, factors, missing } = assessed.risk;
  const top = factors.find((factor) => factor.kind === 'risk');
  const gaps = missing.map((kind) => EVIDENCE_LABEL[kind] ?? kind).join(', ');
  const reason =
    level === 'unknown'
      ? `Not measured: ${gaps}. Until it is, this change cannot be called low risk.`
      : (top?.detail ?? 'Nothing measured raises this change’s risk.');
  return { verdict: VERDICT[level], word: RISK_WORD[level], reason };
}

/** `/dashboard/prs/<project>/<number>`: the pull request's own risk page. */
export function pullRequestRiskPath(projectId: string, number: number): string {
  return `/dashboard/prs/${encodeURIComponent(projectId)}/${String(number)}`;
}

/**
 * An open pull request whose current head was assessed high or critical. A risk assessed at an
 * older head is not one: the change has moved on, and its risk now is not known.
 */
export function riskyPull(pull: GithubPullItem): boolean {
  const risk = pull.risk;
  return (
    pull.state === 'open' &&
    !pull.draft &&
    risk !== null &&
    risk !== undefined &&
    risk.current &&
    isHighRisk(risk.level)
  );
}
