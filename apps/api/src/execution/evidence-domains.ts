/**
 * The gate's security, accessibility and performance domains, from evidence for the run's own
 * commit (plan task 16). Pure: the reader in `services/gate-evidence.ts` gathers the evidence
 * and this decides what it says.
 *
 * - **security** — open SARIF findings on the commit's latest SARIF report, and any ZAP scan
 *   uploaded for the commit. Failed when one is at or above the policy's `maxSeverity`.
 * - **accessibility** — open findings on the commit's latest axe report, the same way.
 * - **performance** — every k6 threshold uploaded for the commit: failed when one was crossed,
 *   unknown when one could not be measured, passed when every one was met.
 *
 * A domain with no evidence is absent from the answer, and the gate keeps it
 * `not_configured`. **No evidence never yields `passed`** (invariant GATE-1).
 */
import type { DomainName, DomainStatus, QualityPolicy } from './types.js';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** Fail at `high` and above unless the policy says otherwise. */
export const DEFAULT_MAX_SEVERITY: Exclude<Severity, 'info'> = 'high';

export interface DomainEvidence {
  /** Severities of the open findings on the commit's latest SARIF report; absent: none. */
  sarif?: readonly Severity[];
  /** ZAP scans uploaded for the commit: whether each reported an alert it counts as failed. */
  zap?: ReadonlyArray<{ failed: boolean }>;
  /** Open findings on the commit's latest axe report; absent: no axe report. */
  axe?: readonly Severity[];
  /** Every k6 threshold uploaded for the commit. */
  k6?: ReadonlyArray<'passed' | 'failed' | 'unknown'>;
}

/** The threshold a policy sets for a domain, through the first rule about it. */
export function maxSeverityFor(
  policy: Pick<QualityPolicy, 'rules'>,
  domain: DomainName,
): Exclude<Severity, 'info'> {
  return policy.rules.find((rule) => rule.domain === domain)?.maxSeverity ?? DEFAULT_MAX_SEVERITY;
}

function findingsVerdict(
  severities: readonly Severity[],
  threshold: Exclude<Severity, 'info'>,
): DomainStatus {
  return severities.some((severity) => RANK[severity] >= RANK[threshold]) ? 'failed' : 'passed';
}

function worst(statuses: readonly DomainStatus[]): DomainStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('unknown')) return 'unknown';
  if (statuses.includes('warning')) return 'warning';
  return 'passed';
}

export function evidenceDomains(
  evidence: DomainEvidence,
  policy: Pick<QualityPolicy, 'rules'>,
): Partial<Record<DomainName, DomainStatus>> {
  const domains: Partial<Record<DomainName, DomainStatus>> = {};
  const security: DomainStatus[] = [];
  if (evidence.sarif !== undefined) {
    security.push(findingsVerdict(evidence.sarif, maxSeverityFor(policy, 'security')));
  }
  for (const scan of evidence.zap ?? []) security.push(scan.failed ? 'failed' : 'passed');
  if (security.length > 0) domains.security = worst(security);
  if (evidence.axe !== undefined) {
    domains.accessibility = findingsVerdict(evidence.axe, maxSeverityFor(policy, 'accessibility'));
  }
  if (evidence.k6 !== undefined && evidence.k6.length > 0) {
    domains.performance = worst(evidence.k6);
  }
  return domains;
}
