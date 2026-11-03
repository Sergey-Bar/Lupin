import type { GithubFinding, GithubHealth } from '@lupin/shared-contracts';
import type {
  AlertSummary,
  CommunityFacts,
  ProtectionFacts,
  SeverityCounts,
} from './github-facts.js';

/**
 * Grades a repository from what the sync stored, and says why.
 *
 * Pure: the same facts give the same findings. Three rules keep it honest.
 *
 *  - **Not read is not clean.** A feed the token cannot see (alerts, protection) is one
 *    informational finding, never a pass, and never a penalty: nobody knows.
 *  - **A finding names its evidence.** A count or a list of what is missing, so the person
 *    reading it can check it against GitHub in one click. The same numbers travel as `params`,
 *    so a client in another language writes its own sentence; `title` and `evidence` are the
 *    English fallback.
 *  - **A repository that has not been synced is not graded.** `score` is `null`, not 100.
 *
 * The thresholds and penalties are the two tables below, so changing what "unhealthy" means is
 * a reviewed edit to a number, not a search through the logic.
 */
export interface RepositoryFacts {
  /** Whether the delivery sync has read this repository. */
  synced: boolean;
  openPullRequests: number;
  /** Open, no activity for {@link STALE_DAYS} days. */
  stalePullRequests: number;
  /** Open, with a failing checks rollup. */
  failingPullRequests: number;
  /** Open, with GitHub reporting merge conflicts. */
  conflictedPullRequests: number;
  /** Open, not a draft, still waiting for a first review after {@link UNREVIEWED_DAYS} days. */
  unreviewedPullRequests: number;
  openIssues: number;
  /** Open, with no label and no assignee. */
  untriagedIssues: number;
  state: {
    community: CommunityFacts | null;
    protection: ProtectionFacts;
    alerts: { dependabot: AlertSummary; codeScanning: AlertSummary; secretScanning: AlertSummary };
  } | null;
}

export const STALE_DAYS = 14;
export const UNREVIEWED_DAYS = 3;
/** A handful of untriaged issues is normal; this many is a backlog nobody is looking at. */
export const UNTRIAGED_MINIMUM = 5;

type Severity = GithubFinding['severity'];
/** A finding before it is given its (possibly empty) params. */
type Draft = Omit<GithubFinding, 'params'> & { params?: GithubFinding['params'] };

/** Points off a score of 100 for each finding of that severity. `info` costs nothing. */
export const PENALTY: Readonly<Record<Severity, number>> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
  info: 0,
};

/** The lowest score that earns each grade, best first. Below the last floor is an F. */
export const GRADE_FLOORS: ReadonlyArray<readonly [string, number]> = [
  ['A', 90],
  ['B', 75],
  ['C', 60],
  ['D', 40],
];

const ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function gradeOf(score: number): string {
  return GRADE_FLOORS.find(([, floor]) => score >= floor)?.[0] ?? 'F';
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`;

const LEVELS = ['critical', 'high', 'medium', 'low'] as const;

/** "3 high, 1 low", worst first, leaving out the zeros. */
function severityList(counts: SeverityCounts): string {
  return LEVELS.filter((level) => counts[level] > 0)
    .map((level) => `${String(counts[level])} ${level}`)
    .join(', ');
}

function worst(counts: SeverityCounts): Severity | null {
  return LEVELS.find((level) => counts[level] > 0) ?? null;
}

const FEED_NAMES = {
  dependabot: 'Dependabot',
  codeScanning: 'code scanning',
  secretScanning: 'secret scanning',
} as const;
type Feed = keyof typeof FEED_NAMES;

const FEED_FINDING: Record<Feed, string> = {
  dependabot: 'dependabot-alerts',
  codeScanning: 'code-scanning-alerts',
  secretScanning: 'secret-alerts',
};

function alertFindings(alerts: NonNullable<RepositoryFacts['state']>['alerts']): Draft[] {
  const found: Draft[] = [];
  const unreadable: Feed[] = [];
  for (const feed of ['dependabot', 'codeScanning', 'secretScanning'] as const) {
    const summary = alerts[feed];
    if ('unavailable' in summary) {
      unreadable.push(feed);
      continue;
    }
    const worstOpen = worst(summary);
    // A leaked credential has no lower grade.
    const severity: Severity | null =
      feed === 'secretScanning' && worstOpen !== null ? 'critical' : worstOpen;
    if (severity === null) continue;
    found.push({
      id: FEED_FINDING[feed],
      severity,
      title: `Open ${FEED_NAMES[feed]} alerts`,
      evidence: `${summary.truncated ? 'at least ' : ''}${severityList(summary)} open`,
      fix: null,
      params: {
        critical: summary.critical,
        high: summary.high,
        medium: summary.medium,
        low: summary.low,
        truncated: summary.truncated,
      },
    });
  }
  if (unreadable.length > 0) {
    found.push({
      id: 'alerts-not-read',
      severity: 'info',
      title: 'Some security alerts could not be read',
      evidence: `The token cannot read ${unreadable.map((feed) => FEED_NAMES[feed]).join(', ')} alerts, so they are not counted either way.`,
      fix: null,
      params: { feeds: unreadable },
    });
  }
  return found;
}

function protectionFindings(protection: ProtectionFacts): Draft[] {
  if (protection.state === 'unprotected') {
    return [
      {
        id: 'no-branch-protection',
        severity: 'high',
        title: 'The default branch is not protected',
        evidence: 'Anyone with write access can push to it directly, or force-push over it.',
        fix: 'protect-branch',
      },
    ];
  }
  if (protection.state === 'unavailable') {
    return [
      {
        id: 'protection-not-read',
        severity: 'info',
        title: 'Branch protection could not be read',
        evidence: 'The token cannot see the default branch’s protection, so it is not graded.',
        fix: null,
      },
    ];
  }
  if (!protection.requiresReview && !protection.requiresChecks) {
    return [
      {
        id: 'weak-branch-protection',
        severity: 'medium',
        title: 'The default branch’s protection requires nothing',
        evidence: 'It requires neither a review nor passing status checks before a merge.',
        fix: 'protect-branch',
      },
    ];
  }
  return [];
}

const COMMUNITY_FILES = [
  ['readme', 'README'],
  ['codeOfConduct', 'code of conduct'],
  ['contributing', 'contributing guide'],
  ['issueTemplate', 'issue template'],
  ['pullRequestTemplate', 'pull request template'],
] as const;

function communityFindings(community: CommunityFacts | null): Draft[] {
  if (community === null) return [];
  const found: Draft[] = [];
  if (!community.license) {
    found.push({
      id: 'no-license',
      severity: 'high',
      title: 'The repository has no license',
      evidence: 'Without one, nobody else has the right to use or change this code.',
      fix: null,
    });
  }
  const absent = COMMUNITY_FILES.filter(([key]) => !community[key]);
  if (absent.length > 0) {
    found.push({
      id: 'missing-community-files',
      severity: 'low',
      title: 'Community files are missing',
      evidence: `Missing: ${absent.map(([, label]) => label).join(', ')}.`,
      fix: null,
      params: { missing: absent.map(([key]) => key) },
    });
  }
  return found;
}

export function analyzeRepository(facts: RepositoryFacts): GithubHealth {
  if (!facts.synced) {
    return {
      score: null,
      grade: null,
      findings: [
        {
          id: 'not-synced',
          severity: 'info',
          title: 'This repository has not been read yet',
          evidence:
            'Turn on the GitHub sync for the project; nothing here is graded until it has run.',
          fix: null,
          params: {},
        },
      ],
    };
  }
  const found: Draft[] = [];
  if (facts.state !== null) {
    found.push(
      ...protectionFindings(facts.state.protection),
      ...communityFindings(facts.state.community),
      ...alertFindings(facts.state.alerts),
    );
  }
  const counted: ReadonlyArray<[number, Draft]> = [
    [
      facts.failingPullRequests,
      {
        id: 'failing-pull-requests',
        severity: 'medium',
        title: 'Pull requests with failing checks',
        evidence: `${plural(facts.failingPullRequests, 'open pull request')} failing checks.`,
        fix: null,
        params: { count: facts.failingPullRequests },
      },
    ],
    [
      facts.conflictedPullRequests,
      {
        id: 'conflicted-pull-requests',
        severity: 'medium',
        title: 'Pull requests with merge conflicts',
        evidence: `${plural(facts.conflictedPullRequests, 'open pull request')} cannot merge until conflicts are resolved.`,
        fix: null,
        params: { count: facts.conflictedPullRequests },
      },
    ],
    [
      facts.unreviewedPullRequests,
      {
        id: 'unreviewed-pull-requests',
        severity: 'medium',
        title: 'Pull requests waiting for a first review',
        evidence: `${plural(facts.unreviewedPullRequests, 'pull request')} open for over ${String(UNREVIEWED_DAYS)} days with no review.`,
        fix: null,
        params: { count: facts.unreviewedPullRequests, days: UNREVIEWED_DAYS },
      },
    ],
    [
      facts.stalePullRequests,
      {
        id: 'stale-pull-requests',
        severity: 'low',
        title: 'Stale pull requests',
        evidence: `${plural(facts.stalePullRequests, 'open pull request')} untouched for ${String(STALE_DAYS)} days or more.`,
        fix: null,
        params: { count: facts.stalePullRequests, days: STALE_DAYS },
      },
    ],
  ];
  for (const [count, finding] of counted) if (count > 0) found.push(finding);
  if (facts.untriagedIssues >= UNTRIAGED_MINIMUM) {
    found.push({
      id: 'untriaged-issues',
      severity: 'low',
      title: 'Issues nobody has triaged',
      evidence: `${plural(facts.untriagedIssues, 'open issue')} with no label and no assignee.`,
      fix: null,
      params: { count: facts.untriagedIssues },
    });
  }
  const findings: GithubFinding[] = found
    .map((finding) => ({ ...finding, params: finding.params ?? {} }))
    .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const score = Math.max(0, 100 - findings.reduce((sum, f) => sum + PENALTY[f.severity], 0));
  return { score, grade: gradeOf(score), findings };
}
