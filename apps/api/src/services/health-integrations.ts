import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { ConnectorAdapter } from '@lupin/connectors-sdk';
import type { GateVerdict } from '@lupin/projects';
import {
  HEALTH_DIMENSION_LABELS,
  type CanonicalFinding,
  type ChangeRiskLevel,
  type DiffCoverageRecord,
  type HealthGrade,
  type HealthLetter,
  type PullRequestRisk,
  type Scorecard,
  type TestTamperFinding,
} from '@lupin/shared-contracts';
import { z } from 'zod/v4';
import type { AiGovernanceCheck } from './repo-health-service.js';
import type { EvalGateReading, EvalGateSuite } from './eval-service.js';
import type { CommitTests } from './commit-tests.js';

/**
 * What the health grade tells the outside world: a pull request's status and comment, and an
 * alert when the default branch gets worse.
 *
 * Every function here takes its transport — the GitHub and Slack adapters, `fetch` — as an
 * argument, so the decisions (what to say, when to say it) are tested without a network.
 */

// ─── GitHub pull requests ─────────────────────────────────────────────────────

/** The host a repository URL must name: github.com, or a GitHub Enterprise Server's. */
export function githubHostOf(apiUrl: string | undefined): string {
  return apiUrl === undefined ? 'github.com' : new URL(apiUrl).hostname;
}

/** The host repository URLs must name; set once at boot by {@link useGitHubApi}. */
let repositoryHost = githubHostOf(undefined);

/** The three spellings of a repository URL on `host`; what follows each is `owner/repo`. */
function prefixesFor(host: string): string[] {
  return [`https://${host}/`, `ssh://git@${host}/`, `git@${host}:`];
}

/**
 * `owner/repo`, optionally ending `.git` and/or `/`. One fixed pattern with no host in it: the host
 * is matched as a plain prefix, so nothing interpolated is ever part of a regular expression.
 */
const OWNER_AND_REPO = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u;

/**
 * Point repository-URL parsing at the configured GitHub API (`GITHUB_API_URL`), once, at boot.
 * One install talks to one GitHub, with one token each call, so a URL on any other host is not
 * one of its repositories. Module state because five services parse repository URLs and none of
 * them has a configuration to ask.
 */
export function useGitHubApi(apiUrl: string | undefined): void {
  repositoryHost = githubHostOf(apiUrl);
}

/** `owner/repo` from a repository URL on the configured GitHub host, in any of the three spellings, or `null`. */
export function githubRepository(url: string | null): { owner: string; repo: string } | null {
  if (url === null) return null;
  const prefix = prefixesFor(repositoryHost).find((candidate) => url.startsWith(candidate));
  if (prefix === undefined) return null;
  const match = OWNER_AND_REPO.exec(url.slice(prefix.length));
  return match === null ? null : { owner: match[1] as string, repo: match[2] as string };
}
/** The comment's first line, which is how the next report finds the comment to update. */
export const COMMENT_MARKER = '<!-- lupin-health -->';
export const STATUS_CONTEXT = 'lupin/health';
const COMMENT_FINDINGS = 10;

export interface GateReport {
  verdict: GateVerdict;
  grade: HealthGrade;
  added: readonly CanonicalFinding[];
  branch: string;
  detailsUrl: string | null;
  /** The commit's diff coverage; a line in the comment when present. */
  diffCoverage?: DiffCoverageRecord | null;
  /** The project's DORA scorecard; one line in the comment whenever it is measured. */
  delivery?: Scorecard | null;
  /** The AI-governance rules on the pull request; a section in the comment when present. */
  aiGovernance?: AiGovernanceCheck | null;
  /** Each eval suite against the default branch; an "Evals" section when any was compared. */
  evals?: EvalGateReading | null;
  /** The commit's test run and the quarantine verdict on it; a "Tests" section when present. */
  tests?: CommitTests | null;
  /** The pull request's change risk at this head; the comment leads with it when present. */
  risk?: PullRequestRisk | null;
  /** What `lupin diff-guard` found on this head; head-side findings become annotations. */
  tamperFindings?: readonly TestTamperFinding[] | null;
}

const RISK_LABEL: Readonly<Record<ChangeRiskLevel, string>> = {
  low: 'Low',
  medium: 'Medium',
  unknown: 'Unknown',
  high: 'High',
  critical: 'Critical',
};
const COMMENT_RISK_FACTORS = 3;

const EVIDENCE_LABEL: Readonly<Record<string, string>> = {
  tests: 'test results',
  'diff-coverage': 'diff coverage',
  attribution: 'who wrote it',
  findings: 'a security scan',
  tampering: 'a diff-guard check',
  evals: 'eval results',
};

/**
 * The "Change risk" section: the level and its score, the factors worth the most points, what
 * was not measured, and how far the change reaches. Every factor is one of the model's own
 * sentences, so the comment says nothing the assessment did not.
 */
export function riskSection(assessed: PullRequestRisk): string[] {
  const { risk, blastRadius } = assessed;
  const factors = risk.factors.filter((factor) => factor.kind === 'risk');
  const lines = [
    `**Change risk: ${RISK_LABEL[risk.level]}** · ${String(risk.score)} points (\`${risk.version}\`)`,
    '',
  ];
  if (factors.length > 0) {
    lines.push('| Points | Why |', '| ---: | --- |');
    for (const factor of factors.slice(0, COMMENT_RISK_FACTORS)) {
      lines.push(`| ${String(factor.points)} | ${inline(factor.detail)} |`);
    }
    if (factors.length > COMMENT_RISK_FACTORS) {
      lines.push(
        '',
        `…and ${String(factors.length - COMMENT_RISK_FACTORS)} more on the dashboard.`,
      );
    }
  }
  if (risk.missing.length > 0) {
    const missing = risk.missing.map((kind) => EVIDENCE_LABEL[kind] ?? kind).join(', ');
    lines.push('', `Not measured, so this cannot be low risk: ${missing}.`);
  }
  if (blastRadius !== null && blastRadius.sensitiveAreas.length > 0) {
    const areas = blastRadius.sensitiveAreas.map((touch) => touch.area).join(', ');
    const teams =
      blastRadius.teams.length === 0
        ? ''
        : ` · owned by ${blastRadius.teams.map(inline).join(', ')}`;
    const cut = blastRadius.truncated ? ' (changed files were truncated)' : '';
    lines.push('', `Reaches: ${inline(areas)}${teams}${cut}.`);
  }
  return lines;
}

const COMMENT_TESTS = 10;

/** Up to ten test identities, made safe for one line, and how many more there were. */
function testList(ids: readonly string[]): string {
  const shown = ids.slice(0, COMMENT_TESTS).map((id) => `\`${inline(id)}\``);
  const more = ids.length > COMMENT_TESTS ? ` …and ${String(ids.length - COMMENT_TESTS)} more` : '';
  return `${shown.join(', ')}${more}`;
}

/**
 * The "Tests" section: the commit's run, which failures are quarantined and which are not,
 * and the flaky tests nobody has quarantined yet. The same verdict `lupin test` acted on,
 * because both read `excusesRun`.
 */
export function testsSection(tests: CommitTests): string[] {
  const lines = [
    '**Tests**',
    '',
    `${String(tests.total)} tests: ${String(tests.passed)} passed, ${String(tests.failed)} failed, ${String(tests.flaky)} flaky.`,
  ];
  if (tests.reportErrors > 0) {
    lines.push(
      `- ${String(tests.reportErrors)} error(s) outside the tests: nothing in this run is excused`,
    );
  }
  if (tests.failures.length > 0) lines.push(`- Failed: ${testList(tests.failures)}`);
  if (tests.quarantinedFailures.length > 0) {
    lines.push(
      `- Failed, quarantined${tests.excused ? ' (excused)' : ''}: ${testList(tests.quarantinedFailures)}`,
    );
  }
  if (tests.flakyUnquarantined.length > 0) {
    lines.push(`- Flaky, not quarantined: ${testList(tests.flakyUnquarantined)}`);
  }
  if (tests.unlabelledFailures > 0) {
    lines.push(`- ${String(tests.unlabelledFailures)} failure(s) whose cause has no triage label`);
  }
  return lines;
}

const EVAL_VERDICTS: Readonly<Record<EvalGateSuite['verdict'], string>> = {
  pass: 'passed',
  fail: 'failed',
  insufficient: 'not enough attempts to tell',
  'no-baseline': 'no baseline on the default branch',
  missing: 'runs on the default branch, not run on this branch',
};
const COMMENT_EVAL_CASES = 5;

/** Up to five case ids, made safe for one line, and how many more there were. */
function caseList(ids: readonly string[]): string {
  const shown = ids.slice(0, COMMENT_EVAL_CASES).map((id) => `\`${inline(id)}\``);
  const more =
    ids.length > COMMENT_EVAL_CASES ? ` …and ${String(ids.length - COMMENT_EVAL_CASES)} more` : '';
  return `${shown.join(', ')}${more}`;
}

/**
 * The "Evals" section: each suite's verdict against the default branch, the cases that
 * regressed beyond noise, and the flaky ones — listed, never a failure on their own. Whether
 * a failed suite failed the gate is the gate's reasons above, which name it only under
 * `gateOnEvals`.
 */
export function evalsSection(evals: EvalGateReading): string[] {
  const lines = ['**Evals**', ''];
  if (!evals.gateOnEvals) {
    lines.push('_Reported only: the policy does not gate on evals (`agents.gateOnEvals`)._', '');
  }
  for (const suite of evals.suites) {
    lines.push(`- \`${inline(suite.suite)}\`: ${EVAL_VERDICTS[suite.verdict]}`);
    if (suite.fellBack) {
      const ran =
        suite.commitSha === null ? 'no commit' : `\`${inline(suite.commitSha.slice(0, 12))}\``;
      lines.push(
        `  - No run on \`${inline(String(evals.commit).slice(0, 12))}\`; fell back to the branch's latest run (${ran})`,
      );
    }
    if (suite.regressions.length > 0) {
      lines.push(`  - Significant regressions: ${caseList(suite.regressions)}`);
    }
    if (suite.flaky.length > 0) lines.push(`  - Flaky: ${caseList(suite.flaky)}`);
  }
  return lines;
}

const ATTRIBUTION_LABELS: Readonly<Record<AiGovernanceCheck['attribution'], string>> = {
  'agent-authored': 'agent-authored',
  'ai-assisted': 'AI-assisted',
  human: 'human',
  unknown: 'unknown',
};

const GOVERNANCE_VERDICTS: Readonly<Record<AiGovernanceCheck['verdict']['verdict'], string>> = {
  pass: 'passed',
  fail: 'failed',
  'not-applicable': 'not applicable — the rules govern AI-written change only',
};

const COMMENT_SIGNALS = 5;

/** Text from a label or a bot login, made safe for one Markdown line. */
const inline = (text: string) => text.replace(/[`|<>\n\r]/gu, ' ');

/**
 * The "AI governance" section: the attribution with its confidence and signals, the verdict
 * and every reason, and — when attribution was unknown — why, so an unread pull request is
 * never silently passed as human.
 */
export function aiGovernanceSection(check: AiGovernanceCheck): string[] {
  const who = `${ATTRIBUTION_LABELS[check.attribution]}${check.agent === null ? '' : ` (${inline(check.agent)})`}`;
  const confidence = `${(check.confidence * 100).toFixed(0)}% confidence`;
  const signals = check.signals.slice(0, COMMENT_SIGNALS).map((signal) => inline(signal.detail));
  const more =
    check.signals.length > COMMENT_SIGNALS
      ? `; …and ${String(check.signals.length - COMMENT_SIGNALS)} more`
      : '';
  const lines = [
    '**AI governance**',
    '',
    `Attribution: ${who}, ${confidence}${signals.length === 0 ? '.' : ` — ${signals.join('; ')}${more}.`}`,
  ];
  if (check.unknownReason !== null) lines.push('', `_${check.unknownReason}_`);
  lines.push('', `Rules: ${GOVERNANCE_VERDICTS[check.verdict.verdict]}.`);
  lines.push(...check.verdict.reasons.map((reason) => `- ${reason}`));
  if (check.verdict.attributionNote !== null) lines.push('', `_${check.verdict.attributionNote}_`);
  return lines;
}

/** The four DORA metrics with a published tier, as the comment names them. */
const DORA_LINE_METRICS: ReadonlyArray<readonly [string, string]> = [
  ['deployment-frequency', 'deployment frequency'],
  ['change-lead-time', 'lead time'],
  ['change-failure-rate', 'change failure rate'],
  ['failed-deployment-recovery-time', 'recovery time'],
];

/**
 * One line on the project's delivery: the DORA score, each banded metric's 2024 tier, and
 * what limited it. Only for a measured scorecard — one with a score; a card resting on too
 * little data has no line rather than a line of dashes.
 */
export function doraLine(card: Scorecard): string {
  const tiers = DORA_LINE_METRICS.map(([key, name]) => {
    const metric = card.metrics.find((entry) => entry.key === key);
    return `${name} ${metric?.band ?? 'not enough data'}`;
  }).join(' · ');
  const verdict = card.status === 'fail' ? ', failing' : '';
  return `**Delivery (DORA 2024):** ${String(card.score)} / 100${verdict} — ${tiers}. Limited by ${String(card.cappedBy)}.`;
}

const COMMENT_RANGES = 10;

/** Consecutive line numbers as `a-b` ranges: `[3, 4, 5, 9]` is `3-5` and `9`. */
export function lineRanges(lines: readonly number[]): string[] {
  const sorted = [...new Set(lines)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start: number | undefined;
  let end = 0;
  for (const line of sorted) {
    if (start !== undefined && line === end + 1) {
      end = line;
      continue;
    }
    if (start !== undefined)
      ranges.push(start === end ? String(start) : `${String(start)}-${String(end)}`);
    start = line;
    end = line;
  }
  if (start !== undefined)
    ranges.push(start === end ? String(start) : `${String(start)}-${String(end)}`);
  return ranges;
}

/** One line on the change's diff coverage, naming up to ten uncovered `file:line` ranges. */
export function diffCoverageLine(diff: DiffCoverageRecord): string {
  if (diff.ratio === null) {
    return '**Diff coverage:** no changed line is executable, so there is nothing to measure.';
  }
  const head = `**Diff coverage:** ${(diff.ratio * 100).toFixed(1)}% — ${String(diff.covered)} of ${plural(
    diff.executable,
    'changed executable line',
  )} ran.`;
  const ranges = diff.uncovered.flatMap((file) =>
    // A path comes from a report, so it may not close the code span.
    lineRanges(file.lines).map((range) => `\`${file.path.replace(/[`\n]/gu, ' ')}:${range}\``),
  );
  if (ranges.length === 0) return head;
  const more =
    ranges.length > COMMENT_RANGES ? `, …and ${String(ranges.length - COMMENT_RANGES)} more` : '';
  return `${head} Uncovered: ${ranges.slice(0, COMMENT_RANGES).join(', ')}${more}.`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** The new findings as a table, at most ten rows. */
function findingsTable(report: GateReport): string[] {
  if (report.added.length === 0) return ['No new findings against the default branch.'];
  const lines = [
    `**${plural(report.added.length, 'new finding')} on \`${report.branch}\`**`,
    '',
    '| Severity | Rule | Location |',
    '| --- | --- | --- |',
  ];
  for (const finding of report.added.slice(0, COMMENT_FINDINGS)) {
    const at = finding.line === null ? '' : `:${String(finding.line)}`;
    const location = finding.path === null ? '—' : `\`${finding.path}${at}\``;
    // A rule id and a path come from a scanner's report, so neither may close the table.
    const rule = finding.ruleId.replace(/[|`\n]/gu, ' ');
    lines.push(
      `| ${finding.severity} | ${finding.tool}: ${rule} | ${location.replace(/\|/gu, ' ')} |`,
    );
  }
  if (report.added.length > COMMENT_FINDINGS) {
    lines.push('', `…and ${String(report.added.length - COMMENT_FINDINGS)} more.`);
  }
  return lines;
}

function headlineOf(grade: HealthGrade): string {
  return grade.letter === null
    ? 'Incomplete'
    : `${grade.letter} · ${String(grade.score ?? 0)} / 100`;
}

/** The sections a report carries only when it measured them, each after a blank line. */
function optionalSections(report: GateReport): string[] {
  const lines: string[] = [];
  if (report.diffCoverage !== null && report.diffCoverage !== undefined) {
    lines.push('', diffCoverageLine(report.diffCoverage));
  }
  if (report.delivery !== null && report.delivery !== undefined && report.delivery.score !== null) {
    lines.push('', doraLine(report.delivery));
  }
  if (report.aiGovernance !== null && report.aiGovernance !== undefined) {
    lines.push('', ...aiGovernanceSection(report.aiGovernance));
  }
  if (report.evals !== null && report.evals !== undefined && report.evals.suites.length > 0) {
    lines.push('', ...evalsSection(report.evals));
  }
  if (report.tests !== null && report.tests !== undefined) {
    lines.push('', ...testsSection(report.tests));
  }
  return lines;
}

export function renderGateComment(report: GateReport): string {
  const { grade, verdict } = report;
  const passed = verdict.verdict === 'passed';
  const lines = [
    COMMENT_MARKER,
    `### Repository health: ${headlineOf(grade)} — ${passed ? 'gate passed' : 'gate failed'}`,
    '',
    grade.limiter ?? grade.incompleteReason ?? '',
    '',
  ];
  // The change's own risk leads: the grade is the repository's, the risk is this pull request's.
  if (report.risk !== null && report.risk !== undefined) {
    lines.push(...riskSection(report.risk), '');
  }
  if (verdict.reasons.length > 0) {
    lines.push(
      '**Why the gate failed**',
      '',
      ...verdict.reasons.map((reason) => `- ${reason}`),
      '',
    );
  }
  lines.push(...findingsTable(report), ...optionalSections(report));
  const dimensions = grade.dimensions
    .filter((entry) => entry.measured)
    .map((entry) => `${HEALTH_DIMENSION_LABELS[entry.dimension]} ${entry.letter ?? '—'}`)
    .join(' · ');
  if (dimensions.length > 0) lines.push('', dimensions);
  if (report.detailsUrl !== null) lines.push('', `[Open the dashboard](${report.detailsUrl})`);
  return lines.join('\n');
}

export interface PullRequestTarget {
  owner: string;
  repo: string;
  sha: string;
  pullRequest?: number | undefined;
}

export type GitHubReport = {
  status: boolean;
  comment: 'created' | 'updated' | 'skipped' | 'failed';
  /**
   * The change-risk check run, present only when the report carried an assessment.
   * `unavailable`: GitHub refused the token (a personal token cannot write check runs; an
   * installation token, such as Actions' own, can), so the commit status stands alone.
   */
  check?: 'created' | 'updated' | 'unavailable' | 'failed';
  error?: string;
};

/**
 * The check run's name. A second context beside `lupin/health`, never replacing it, so the
 * branch rules that already require `lupin/health` keep working unchanged.
 */
export const CHECK_RUN_NAME = 'lupin/change-risk';
/** GitHub accepts at most 50 annotations per request. */
export const MAX_ANNOTATIONS = 50;

interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  title: string;
  message: string;
}

const TAMPER_TITLE: Readonly<Record<string, string>> = {
  'skip-added': 'A test was skipped or focused',
  'assertion-loosened': 'An assertion was loosened',
  'empty-catch': 'An empty catch in a test',
  'threshold-lowered': 'A threshold was lowered',
  'ci-made-non-failing': 'A CI step can no longer fail',
  'retry-added': 'A retry was added',
};

/** Consecutive line numbers as `[start, end]` ranges. */
function ranges(lines: readonly number[]): Array<[number, number]> {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const line of sorted) {
    const last = out.at(-1);
    if (last !== undefined && line === last[1] + 1) last[1] = line;
    else out.push([line, line]);
  }
  return out;
}

/**
 * Annotations on the head: every tampered line the diff still has, then the uncovered lines of
 * the files in a sensitive area. A removal is on the base side, which a check run cannot point
 * at, so it is in the summary and not here.
 */
export function riskAnnotations(report: GateReport): Annotation[] {
  const tampered: Annotation[] = (report.tamperFindings ?? []).flatMap((finding) =>
    finding.side === 'head' && finding.line !== null && TAMPER_TITLE[finding.kind] !== undefined
      ? [
          {
            path: finding.path,
            start_line: finding.line,
            end_line: finding.line,
            annotation_level: 'failure' as const,
            title: TAMPER_TITLE[finding.kind] as string,
            message: 'lupin diff-guard: this change weakens the tests that judge it.',
          },
        ]
      : [],
  );
  const sensitive = new Set(
    report.risk?.blastRadius?.sensitiveAreas.flatMap((touch) => touch.paths) ?? [],
  );
  const uncovered: Annotation[] = (report.diffCoverage?.uncovered ?? [])
    .filter((entry) => sensitive.has(entry.path))
    .flatMap((entry) =>
      ranges(entry.lines).map(([start, end]) => ({
        path: entry.path,
        start_line: start,
        end_line: end,
        annotation_level: 'warning' as const,
        title: 'Not covered by any test',
        message: 'Changed lines in a sensitive area that no test ran.',
      })),
    );
  return [...tampered, ...uncovered].slice(0, MAX_ANNOTATIONS);
}

/** `failure` when the gate failed; `neutral` for a high risk it only reports; else `success`. */
function conclusionOf(report: GateReport): 'failure' | 'neutral' | 'success' {
  if (report.verdict.verdict !== 'passed') return 'failure';
  const level = report.risk?.risk.level;
  return level === 'high' || level === 'critical' || level === 'unknown' ? 'neutral' : 'success';
}

const CheckRunListSchema = z.object({
  items: z.array(z.object({ id: z.number(), name: z.string().optional() })),
});

/** A refusal that means "this token may not", as opposed to a write that went wrong. */
const refusedToken = (code: string | undefined) => /_(?:rejected_)?(?:403|404)$/u.test(code ?? '');

type CheckOutcome = { check: NonNullable<GitHubReport['check']>; error?: string };

/** A GitHub refusal as the check's outcome: the token may not, or the write went wrong. */
function refusalOf(code: string | undefined): CheckOutcome {
  return {
    check: refusedToken(code) ? 'unavailable' : 'failed',
    ...(code === undefined ? {} : { error: code }),
  };
}

/** The run's state and output: the conclusion, the risk's own sentences, the annotations. */
function checkRunBody(report: GateReport, risk: PullRequestRisk, sha: string) {
  return {
    status: 'completed',
    conclusion: conclusionOf(report),
    external_id: `${String(risk.pullRequest)}:${sha}`,
    ...(report.detailsUrl === null ? {} : { details_url: report.detailsUrl }),
    output: {
      title: `Change risk: ${risk.risk.level} · ${String(risk.risk.score)} points`.slice(0, 255),
      summary: riskSection(risk).join('\n'),
      annotations: riskAnnotations(report),
    },
  };
}

/** Creates the head's check run, or updates the one that is already there. */
async function upsertCheckRun(
  github: ConnectorAdapter,
  token: string,
  base: { owner: string; repo: string },
  sha: string,
  report: GateReport,
  risk: PullRequestRisk,
): Promise<CheckOutcome> {
  const listed = await github.execute(
    {
      operation: 'listCheckRuns',
      input: { ...base, ref: sha, checkName: CHECK_RUN_NAME, pages: 1 },
    },
    token,
  );
  if (listed.status !== 'ok') return refusalOf(listed.error?.code);
  const runs = CheckRunListSchema.safeParse(listed.data);
  const existing = runs.success
    ? runs.data.items.find((run) => run.name === CHECK_RUN_NAME)
    : undefined;
  const body = checkRunBody(report, risk, sha);
  const request =
    existing === undefined
      ? {
          operation: 'createCheckRun',
          input: { ...base, name: CHECK_RUN_NAME, head_sha: sha, ...body },
        }
      : {
          operation: 'updateCheckRun',
          input: { ...base, checkRunId: String(existing.id), ...body },
        };
  const written = await github.execute(request, token);
  if (written.status !== 'ok') return refusalOf(written.error?.code);
  return { check: existing === undefined ? 'created' : 'updated' };
}

function statusDescription(report: GateReport): string {
  const fallback =
    report.grade.letter === null ? 'Grade incomplete' : `Graded ${report.grade.letter}`;
  const reason = report.verdict.reasons[0] ?? fallback;
  const risk = report.risk?.risk.level;
  return (risk === undefined ? reason : `Risk ${risk} · ${reason}`).slice(0, 140);
}

const CommentListSchema = z.array(
  z.object({ id: z.number(), body: z.string().nullable().optional() }),
);

/** Updates the comment that starts with the marker, or creates one. */
async function upsertComment(
  github: ConnectorAdapter,
  token: string,
  base: { owner: string; repo: string },
  number: string,
  body: string,
): Promise<{ comment: GitHubReport['comment']; error?: string }> {
  const listed = await github.execute(
    { operation: 'listIssueComments', input: { ...base, number } },
    token,
  );
  if (listed.status !== 'ok')
    return { comment: 'failed', error: listed.error?.code ?? 'list_failed' };
  const comments = CommentListSchema.safeParse(listed.data);
  const existing = comments.success
    ? comments.data.find((comment) => comment.body?.startsWith(COMMENT_MARKER) === true)
    : undefined;
  const written =
    existing === undefined
      ? await github.execute(
          { operation: 'createIssueComment', input: { ...base, number, body } },
          token,
        )
      : await github.execute(
          {
            operation: 'updateIssueComment',
            input: { ...base, commentId: String(existing.id), body },
          },
          token,
        );
  if (written.status !== 'ok')
    return {
      comment: 'failed',
      ...(written.error === undefined ? {} : { error: written.error.code }),
    };
  return { comment: existing === undefined ? 'created' : 'updated' };
}

/**
 * Posts the commit status, the change-risk check run when the report carries an assessment,
 * and creates or updates the one gate comment.
 *
 * The status is always posted, because it is what branch protection already requires; the
 * check run sits beside it and carries the factors and the line annotations a status cannot.
 * Returns what it did, never throws for a GitHub refusal: a gate whose verdict was computed
 * should be returned to the CI job even when GitHub said no to the comment.
 */
export async function reportToGitHub(
  github: ConnectorAdapter,
  token: string,
  target: PullRequestTarget,
  report: GateReport,
): Promise<GitHubReport> {
  const base = { owner: target.owner, repo: target.repo };
  const status = await github.execute(
    {
      operation: 'createCommitStatus',
      input: {
        ...base,
        sha: target.sha,
        state: report.verdict.verdict === 'passed' ? 'success' : 'failure',
        context: STATUS_CONTEXT,
        description: statusDescription(report),
        ...(report.detailsUrl === null ? {} : { target_url: report.detailsUrl }),
      },
    },
    token,
  );
  const posted = status.status === 'ok';
  const risk = report.risk ?? null;
  const check =
    risk === null ? null : await upsertCheckRun(github, token, base, target.sha, report, risk);
  const checked = check === null ? {} : { check: check.check };
  const firstError = status.error?.code ?? check?.error;
  if (target.pullRequest === undefined) {
    return {
      status: posted,
      comment: 'skipped',
      ...checked,
      ...(firstError === undefined ? {} : { error: firstError }),
    };
  }
  const comment = await upsertComment(
    github,
    token,
    base,
    String(target.pullRequest),
    renderGateComment(report),
  );
  const error = comment.error ?? check?.error;
  return {
    status: posted,
    comment: comment.comment,
    ...checked,
    ...(error === undefined ? {} : { error }),
  };
}
// ─── Alerts ───────────────────────────────────────────────────────────────────

export const AlertSettingsSchema = z.object({
  webhookUrl: z.string().url().max(2000).nullable().optional(),
  slackChannel: z
    .string()
    .regex(/^[#A-Za-z0-9._-]{1,80}$/u)
    .nullable()
    .optional(),
});
export type AlertSettings = z.infer<typeof AlertSettingsSchema>;

/**
 * A webhook target this install may call: `https`, and not a loopback, private or
 * link-local address written as a literal.
 *
 * The server makes the request, so a URL is a request the server makes on the caller's
 * behalf. A hostname that *resolves* to a private address is not caught here — an operator
 * who can configure alerts is trusted not to point them at the metadata service, and the
 * install's egress policy is where that is enforced.
 */
export function isAllowedWebhook(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '')
    return false;
  const host = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    return false;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number) as [number, number];
    return !(
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(host) === 6)
    return !(
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80')
    );
  return true;
}

export type HealthAlert =
  | {
      kind: 'grade-dropped';
      from: HealthLetter | null;
      to: HealthLetter | null;
      limiter: string | null;
    }
  | {
      kind: 'new-critical';
      findings: Array<Pick<CanonicalFinding, 'tool' | 'ruleId' | 'path' | 'line'>>;
    };

const ORDER: readonly (HealthLetter | null)[] = [null, 'F', 'D', 'C', 'B', 'A', 'A+'];

/**
 * The alerts one report produced, on the default branch only.
 *
 * Deduplicated by construction: a drop fires on the transition, so a grade that stays at D
 * does not alert twice, and a finding is new exactly once.
 */
export function alertsFor(input: {
  previous: { letter: HealthLetter | null } | null;
  current: HealthGrade;
  added: readonly CanonicalFinding[];
  onDefaultBranch: boolean;
}): HealthAlert[] {
  if (!input.onDefaultBranch) return [];
  const alerts: HealthAlert[] = [];
  const before = input.previous?.letter ?? null;
  const after = input.current.letter;
  if (input.previous !== null && before !== null && ORDER.indexOf(after) < ORDER.indexOf(before)) {
    alerts.push({
      kind: 'grade-dropped',
      from: before,
      to: after,
      limiter: input.current.limiter ?? input.current.incompleteReason,
    });
  }
  const critical = input.added.filter((finding) => finding.severity === 'critical');
  if (critical.length > 0) {
    alerts.push({
      kind: 'new-critical',
      findings: critical.slice(0, 20).map((finding) => ({
        tool: finding.tool,
        ruleId: finding.ruleId,
        path: finding.path,
        line: finding.line,
      })),
    });
  }
  return alerts;
}

export function alertText(project: string, alert: HealthAlert, detailsUrl: string | null): string {
  const link = detailsUrl === null ? '' : ` ${detailsUrl}`;
  if (alert.kind === 'grade-dropped') {
    return `${project}: health fell from ${alert.from ?? '—'} to ${alert.to ?? 'incomplete'}. ${alert.limiter ?? ''}${link}`.trim();
  }
  const first = alert.findings[0];
  const where =
    first === undefined
      ? ''
      : ` — ${first.tool}: ${first.ruleId}${first.path === null ? '' : ` in ${first.path}`}`;
  return `${project}: ${String(alert.findings.length)} new critical finding${alert.findings.length === 1 ? '' : 's'}${where}.${link}`;
}

export interface AlertTransport {
  slack?: { adapter: ConnectorAdapter; token: string } | undefined;
  /** Signs webhook bodies. Absent: webhooks are not sent, because an unsigned one is spoofable. */
  webhookSecret?: string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** The signature header value: `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export function signWebhook(secret: string, body: string, unixSeconds: number): string {
  const mac = createHmac('sha256', secret)
    .update(`${String(unixSeconds)}.${body}`)
    .digest('hex');
  return `t=${String(unixSeconds)},v1=${mac}`;
}

interface AlertEvent {
  projectId: string;
  project: string;
  branch: string;
  detailsUrl: string | null;
  alerts: readonly HealthAlert[];
}

async function sendSlack(
  slack: NonNullable<AlertTransport['slack']>,
  channel: string,
  event: AlertEvent,
): Promise<string[]> {
  const outcomes: string[] = [];
  for (const alert of event.alerts) {
    const result = await slack.adapter.execute(
      {
        operation: 'postMessage',
        input: { channel, text: alertText(event.project, alert, event.detailsUrl) },
      },
      slack.token,
    );
    outcomes.push(
      `slack ${alert.kind}: ${result.status === 'ok' ? 'sent' : (result.error?.code ?? 'failed')}`,
    );
  }
  return outcomes;
}

async function sendWebhook(
  transport: AlertTransport,
  secret: string,
  url: string,
  event: AlertEvent,
): Promise<string> {
  const body = JSON.stringify({
    type: 'lupin.health.alert',
    projectId: event.projectId,
    project: event.project,
    branch: event.branch,
    detailsUrl: event.detailsUrl,
    alerts: event.alerts,
  });
  const unix = Math.floor((transport.now?.() ?? new Date()).getTime() / 1000);
  try {
    const response = await (transport.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lupin-signature': signWebhook(secret, body, unix),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    return `webhook: ${String(response.status)}`;
  } catch (error) {
    return `webhook: ${error instanceof Error ? error.message : 'failed'}`;
  }
}

/** Sends every alert to every configured target. Returns one line per delivery, for the log. */
export async function deliverAlerts(
  transport: AlertTransport,
  settings: AlertSettings,
  event: AlertEvent,
): Promise<string[]> {
  if (event.alerts.length === 0) return [];
  const outcomes: string[] = [];
  if (settings.slackChannel != null && transport.slack !== undefined) {
    outcomes.push(...(await sendSlack(transport.slack, settings.slackChannel, event)));
  }
  const { webhookUrl } = settings;
  if (webhookUrl != null && transport.webhookSecret !== undefined && isAllowedWebhook(webhookUrl)) {
    outcomes.push(await sendWebhook(transport, transport.webhookSecret, webhookUrl, event));
  }
  return outcomes;
}
