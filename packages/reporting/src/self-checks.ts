/**
 * The install noticing its own faults (plan 1795712849115 task 16). Pure: the caller passes
 * what it observed, and each check says whether something needs a person, with the fix.
 *
 * A fact the caller could not observe is `undefined` and its check stays silent: a check
 * that guessed would cry wolf on every fresh install, and one that cried wolf would be the
 * first thing a person learned to ignore. Each item names one fix, and the fix is a place in
 * the product or a command, never a sentence to work out.
 */

export interface SelfCheckFacts {
  now: Date;
  /** When the newest test result arrived, `null` when none ever has. */
  lastResultAt?: string | null;
  /** When any runner last sent a heartbeat, `null` when none has since the API started. */
  lastHeartbeatAt?: string | null;
  /** Whether any job is queued, so an offline runner matters. */
  queuedJobs?: number;
  /** Calls and failures per connector, since the API started. */
  connectors?: Readonly<Record<string, { calls: number; failures: number }>>;
  /** When the newest backup was written; only the start scripts can see this. */
  lastBackupAt?: string | null;
  /** Runs in the last seven days, and how many of them a quality gate judged. */
  recentRuns?: { total: number; gated: number };
}

export interface SelfCheckItem {
  id: string;
  severity: 'bad' | 'caution';
  title: string;
  detail: string;
  fix: { label: string; to: string };
  at: string;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const SELF_CHECK_LIMITS = {
  /** Results are expected at least daily on an install that has ever had any. */
  silentResultsMs: 2 * DAY,
  /** A runner heartbeats every few seconds; five minutes of silence with work queued is offline. */
  runnerSilentMs: 5 * MINUTE,
  /** A connector failing at least this often, and at least half its calls, is broken. */
  connectorFailures: 3,
  backupMs: 7 * DAY,
} as const;

function age(now: Date, at: string): number {
  const time = Date.parse(at);
  return Number.isFinite(time) ? now.getTime() - time : Number.NaN;
}

function duration(ms: number): string {
  if (ms >= DAY) return `${String(Math.floor(ms / DAY))} days`;
  if (ms >= 60 * MINUTE) return `${String(Math.floor(ms / (60 * MINUTE)))} hours`;
  return `${String(Math.max(1, Math.floor(ms / MINUTE)))} min`;
}

function silentResults(facts: SelfCheckFacts): SelfCheckItem[] {
  if (facts.lastResultAt === undefined || facts.lastResultAt === null) return [];
  const silent = age(facts.now, facts.lastResultAt);
  if (!(silent > SELF_CHECK_LIMITS.silentResultsMs)) return [];
  return [
    {
      id: 'self-results-silent',
      severity: 'caution',
      title: `No test results for ${duration(silent)}`,
      detail: 'CI may have stopped sending them',
      fix: { label: 'Check how results are sent', to: '/dashboard/setup' },
      at: facts.lastResultAt,
    },
  ];
}

function runnerOffline(facts: SelfCheckFacts): SelfCheckItem[] {
  if ((facts.queuedJobs ?? 0) === 0 || facts.lastHeartbeatAt === undefined) return [];
  const at = facts.lastHeartbeatAt;
  const silent = at === null ? Number.POSITIVE_INFINITY : age(facts.now, at);
  if (!(silent > SELF_CHECK_LIMITS.runnerSilentMs)) return [];
  return [
    {
      id: 'self-runner-offline',
      severity: 'bad',
      title: at === null ? 'No runner has connected' : `Runner offline for ${duration(silent)}`,
      detail: `${String(facts.queuedJobs)} queued ${facts.queuedJobs === 1 ? 'job is' : 'jobs are'} waiting`,
      fix: { label: 'Open runners', to: '/dashboard/runner' },
      at: at ?? facts.now.toISOString(),
    },
  ];
}

function failingConnectors(facts: SelfCheckFacts): SelfCheckItem[] {
  return Object.entries(facts.connectors ?? {})
    .filter(
      ([, { calls, failures }]) =>
        failures >= SELF_CHECK_LIMITS.connectorFailures && failures * 2 >= calls,
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { calls, failures }]) => ({
      id: `self-connector-${name}`,
      severity: 'caution' as const,
      title: `${name} is failing`,
      detail: `${String(failures)} of its last ${String(calls)} calls failed`,
      fix: { label: 'Open connections', to: '/dashboard/settings/integrations' },
      at: facts.now.toISOString(),
    }));
}

function staleBackup(facts: SelfCheckFacts): SelfCheckItem[] {
  if (facts.lastBackupAt === undefined) return [];
  const stale =
    facts.lastBackupAt === null ? Number.POSITIVE_INFINITY : age(facts.now, facts.lastBackupAt);
  if (!(stale > SELF_CHECK_LIMITS.backupMs)) return [];
  return [
    {
      id: 'self-backup-stale',
      severity: 'caution',
      title: facts.lastBackupAt === null ? 'No backup yet' : `Last backup ${duration(stale)} ago`,
      detail: 'Run ./start.sh backup, or schedule it',
      fix: { label: 'Open deployment', to: '/dashboard/settings/deployment' },
      at: facts.lastBackupAt ?? facts.now.toISOString(),
    },
  ];
}

function ungated(facts: SelfCheckFacts): SelfCheckItem[] {
  const recent = facts.recentRuns;
  if (recent === undefined || recent.total < 3 || recent.gated > 0) return [];
  return [
    {
      id: 'self-ungated',
      severity: 'caution',
      title: 'Runs arrive but no quality gate judges them',
      detail: `${String(recent.total)} runs this week had no gate verdict`,
      fix: { label: 'Set a quality gate', to: '/dashboard/settings/quality-gates' },
      at: facts.now.toISOString(),
    },
  ];
}

/** Every check, worst first. */
export function selfChecks(facts: SelfCheckFacts): SelfCheckItem[] {
  return [
    ...runnerOffline(facts),
    ...silentResults(facts),
    ...failingConnectors(facts),
    ...ungated(facts),
    ...staleBackup(facts),
  ].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'bad' ? -1 : 1));
}
