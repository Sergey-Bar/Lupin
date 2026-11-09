import type { DeliverySummary, GithubPullItem, Portfolio } from '@lupin/shared-contracts';
import type { Run } from './api.js';

/**
 * "What needs me now", as at most five items, worst first, each with one action.
 *
 * Pure, so the ranking is tested as a function rather than through a page. The inputs are
 * what the dashboard already reads — runs, the portfolio, report deliveries — so the Now
 * page adds no endpoint and no second opinion about what a failure is.
 */
export interface AttentionItem {
  id: string;
  severity: 'bad' | 'caution';
  title: string;
  detail: string;
  /** The one thing to do about it. */
  action: { label: string; to: string };
  /** What Lupin can do about it for you, in one click, when the page can take the action. */
  auto?: { kind: 'retry-run'; runId: string };
  /** When it happened, for ordering and the "new since your last visit" marker. */
  at: string;
}

export const MAX_ATTENTION = 5;
const STUCK_MS = 60 * 60_000;
const NEEDS_ATTENTION = new Set(['C', 'D', 'F']);

function runLabel(run: Run): string {
  return run.suite ?? run.testType ?? `run ${run.id.slice(0, 8)}`;
}

/**
 * What broke, said as the work: how many tests, on which branch. `browser failed` named a test
 * type, which tells nobody where to look.
 */
function failureTitle(run: Run): string {
  const failed = run.summary?.failed ?? 0;
  const where = run.branch ?? runLabel(run);
  if (failed <= 0) return `${where} is failing`;
  return `${String(failed)} ${failed === 1 ? 'test' : 'tests'} failing on ${where}`;
}

function runItems(runs: readonly Run[], now: Date): AttentionItem[] {
  const items: AttentionItem[] = [];
  // The newest failure per suite: three red runs of one suite are one thing to fix.
  const seenFailed = new Set<string>();
  for (const run of [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const at = run.completedAt ?? run.startedAt ?? run.createdAt;
    if (run.outcome === 'failed' || run.outcome === 'blocked') {
      // One item per branch (or per suite when there is no branch): five red runs on one
      // branch are one thing to untangle, and the newest of them is the one to open.
      const key = run.branch ?? runLabel(run);
      if (seenFailed.has(key)) continue;
      seenFailed.add(key);
      items.push({
        id: `run-failed-${run.id}`,
        severity: 'bad',
        title: failureTitle(run),
        detail: run.suite ?? (run.branch === null ? 'Latest run' : 'Latest run on this branch'),
        action: { label: 'Open run', to: `/dashboard/runs/${run.id}` },
        auto: { kind: 'retry-run', runId: run.id },
        at,
      });
    } else if (
      run.phase === 'running' &&
      run.startedAt !== null &&
      now.getTime() - new Date(run.startedAt).getTime() > STUCK_MS
    ) {
      items.push({
        id: `run-stuck-${run.id}`,
        severity: 'caution',
        title: `${runLabel(run)} has been running over an hour`,
        detail: 'It may be stuck',
        action: { label: 'Open run', to: `/dashboard/runs/${run.id}` },
        at: run.startedAt,
      });
    }
  }
  return items;
}

function portfolioItems(portfolio: Portfolio | null): AttentionItem[] {
  if (portfolio === null) return [];
  return portfolio.projects
    .filter(
      (entry) =>
        (entry.letter !== null && NEEDS_ATTENTION.has(entry.letter)) || (entry.trend ?? 0) < 0,
    )
    .map((entry) => ({
      id: `health-${entry.projectId}`,
      severity:
        entry.letter === 'F' || entry.letter === 'D' ? ('bad' as const) : ('caution' as const),
      title: `${entry.name} is graded ${entry.letter ?? '—'}`,
      detail: entry.limiter ?? 'Health is falling',
      action: { label: 'Open health', to: `/dashboard/repo/${entry.projectId}` },
      at: entry.lastReportAt ?? '1970-01-01T00:00:00.000Z',
    }));
}

function deliveryItems(deliveries: readonly DeliverySummary[]): AttentionItem[] {
  const failed = deliveries.filter((delivery) => delivery.status === 'failed');
  const [latest] = failed;
  if (latest === undefined) return [];
  return [
    {
      id: `delivery-${latest.id}`,
      severity: 'caution',
      title:
        failed.length === 1
          ? 'A report did not arrive'
          : `${String(failed.length)} reports did not arrive`,
      detail: latest.errorCode ?? 'Delivery failed',
      action: { label: 'Open reports', to: '/dashboard/reports' },
      at: latest.scheduledFor,
    },
  ];
}

export interface AttentionInput {
  runs: readonly Run[];
  portfolio: Portfolio | null;
  deliveries: readonly DeliverySummary[];
  /** Open pull requests, when GitHub is connected. */
  pulls?: readonly GithubPullItem[];
  now: Date;
}

/** Every item, worst first and newest first within a severity, and how many there were. */
export function rankAttention(input: AttentionInput): { items: AttentionItem[]; total: number } {
  const all = [
    ...runItems(input.runs, input.now),
    ...portfolioItems(input.portfolio),
    ...deliveryItems(input.deliveries),
    ...pullItems(input.pulls ?? []),
  ].sort((a, b) =>
    a.severity === b.severity ? b.at.localeCompare(a.at) : a.severity === 'bad' ? -1 : 1,
  );
  return { items: all.slice(0, MAX_ATTENTION), total: all.length };
}

/** Whether something happened since the person last opened the Now page. */
export function isNew(item: AttentionItem, lastVisit: string | null): boolean {
  return lastVisit !== null && item.at > lastVisit;
}

/**
 * Open pull requests that are stuck, said as the work: blocked by failing checks (a red item),
 * or sent back for changes (a caution). Drafts are the author's own business and are skipped.
 */
export function pullItems(pulls: readonly GithubPullItem[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const pull of pulls) {
    if (pull.state !== 'open' || pull.draft) continue;
    const blocked = pull.checksState === 'failure';
    const changes = pull.reviewDecision === 'changes_requested';
    if (!blocked && !changes) continue;
    items.push({
      id: `pull-${pull.id}`,
      severity: blocked ? 'bad' : 'caution',
      title: blocked
        ? `PR #${String(pull.number)} is blocked by failing checks`
        : `PR #${String(pull.number)} needs changes`,
      detail: `${pull.repository} · ${pull.title}`,
      action: {
        label: 'Open PR',
        to: `/dashboard/prs?project=${encodeURIComponent(pull.projectId)}`,
      },
      at: pull.lastActivityAt,
    });
  }
  return items;
}
