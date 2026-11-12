import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorAdapter, ConnectorRequest } from '@lupin/connectors-sdk';
import {
  HEALTH_DIMENSIONS,
  type CanonicalFinding,
  type HealthGrade,
  type PullRequestRisk,
  type Scorecard,
} from '@lupin/shared-contracts';
import {
  CHECK_RUN_NAME,
  COMMENT_MARKER,
  MAX_ANNOTATIONS,
  aiGovernanceSection,
  alertsFor,
  evalsSection,
  deliverAlerts,
  doraLine,
  githubHostOf,
  githubPayload,
  githubRepository,
  useGitHubApi,
  isAllowedWebhook,
  renderGateComment,
  reportToGitHub,
  riskSection,
  riskAnnotations,
  signWebhook,
  testsSection,
  diffCoverageLine,
  lineRanges,
  type GateReport,
} from './health-integrations.js';
import type { AiGovernanceCheck } from './repo-health-service.js';

function grade(
  letter: HealthGrade['letter'],
  limiter = 'Limited by Security — 1 high open from semgrep',
): HealthGrade {
  return {
    score: letter === null ? null : 72,
    letter,
    incomplete: letter === null,
    incompleteReason: letter === null ? 'Security has not been measured' : null,
    cappedBy: letter === null ? null : 'security',
    cappingValue: null,
    limiter: letter === null ? null : limiter,
    dimensions: HEALTH_DIMENSIONS.map((dimension) => ({
      dimension,
      measured: dimension === 'security',
      score: dimension === 'security' ? 72 : null,
      letter: dimension === 'security' ? letter : null,
      weight: 1,
      tools: [],
      openFindings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      summary: [],
    })),
    gates: [],
    fixNext: [],
  };
}

function finding(overrides: Partial<CanonicalFinding> = {}): CanonicalFinding {
  return {
    fingerprint: 'fp',
    tool: 'semgrep',
    ruleId: 'sql-injection',
    kind: 'issue',
    severity: 'critical',
    dimension: 'security',
    path: 'src/db.ts',
    line: 12,
    message: 'm',
    helpUri: null,
    fixAvailable: null,
    ...overrides,
  };
}

/** A connector that answers from a table of operations and records every request. */
function fakeAdapter(answers: Record<string, unknown>, failing: readonly string[] = []) {
  const requests: ConnectorRequest[] = [];
  const adapter: ConnectorAdapter = {
    manifest: { name: 'fake', version: '1', operations: {} },
    execute: vi.fn(async (request: ConnectorRequest) => {
      requests.push(request);
      if (failing.includes(request.operation)) {
        return {
          status: 'error' as const,
          error: { code: 'github_403', retryable: false, message: 'no' },
          attempts: 1,
        };
      }
      return { status: 'ok' as const, data: answers[request.operation] ?? {}, attempts: 1 };
    }),
  };
  return { adapter, requests };
}

describe('githubRepository', () => {
  it.each([
    ['https://github.com/o/r.git', { owner: 'o', repo: 'r' }],
    ['https://github.com/o/r', { owner: 'o', repo: 'r' }],
    ['git@github.com:o/r.git', { owner: 'o', repo: 'r' }],
    ['ssh://git@github.com/o/r.git', { owner: 'o', repo: 'r' }],
    ['https://github.com/o/r/', { owner: 'o', repo: 'r' }],
    ['https://gitlab.com/o/r.git', null],
    ['https://github.com.evil.test/o/r', null],
    // Whatever follows `owner/repo` is refused, not ignored: a deeper path is not a repository.
    ['https://github.com/o/r/pull/1', null],
    ['https://github.com/o', null],
    ['https://github.com/', null],
    // The host is a prefix, so a URL that merely contains it later is not on that host.
    ['https://evil.test/https://github.com/o/r', null],
    ['https://github.com@evil.test/o/r', null],
    [null, null],
  ])('%s → %j', (url, expected) => {
    expect(githubRepository(url)).toEqual(expected);
  });
});

describe('githubRepository on GitHub Enterprise Server', () => {
  afterEach(() => {
    useGitHubApi(undefined);
  });

  it('takes the host from the configured API base', () => {
    expect(githubHostOf(undefined)).toBe('github.com');
    expect(githubHostOf('https://ghe.example.com/api/v3')).toBe('ghe.example.com');
  });

  it('reads repositories on that host, and only that host: the token belongs to one API', () => {
    useGitHubApi('https://ghe.example.com/api/v3');
    expect(githubRepository('https://ghe.example.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' });
    expect(githubRepository('git@ghe.example.com:o/r.git')).toEqual({ owner: 'o', repo: 'r' });
    expect(githubRepository('https://github.com/o/r')).toBeNull();
    expect(githubRepository('https://ghe.example.com.evil.test/o/r')).toBeNull();
    // A dot in the host is a dot, not "any character".
    expect(githubRepository('https://gheXexample.com/o/r')).toBeNull();
  });
});

describe('the pull-request comment', () => {
  const report = {
    verdict: {
      verdict: 'failed' as const,
      reasons: ['1 new critical finding (at most 0 allowed)'],
      newFindings: { critical: 1, high: 0, total: 1 },
    },
    grade: grade('C'),
    added: [finding({ ruleId: 'evil|rule`', path: 'a|b.ts' })],
    branch: 'feature/x',
    detailsUrl: 'https://lupin.example/dashboard/repo/p',
  };

  it('starts with the marker, says why the gate failed, and links to the dashboard', () => {
    const body = renderGateComment(report);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('C · 72 / 100 — gate failed');
    expect(body).toContain('- 1 new critical finding (at most 0 allowed)');
    expect(body).toContain('[Open the dashboard](https://lupin.example/dashboard/repo/p)');
    expect(body).toContain('Security C');
  });

  it('keeps a scanner-supplied rule or path from breaking the table', () => {
    const row = renderGateComment(report)
      .split('\n')
      .find((line) => line.startsWith('| critical'));
    expect(row?.split('|')).toHaveLength(5);
  });

  const assessed = (overrides: Partial<PullRequestRisk['risk']> = {}): PullRequestRisk => ({
    pullRequest: 12,
    headSha: 'b'.repeat(40),
    assessedAt: '2026-11-11T09:00:00.000Z',
    blastRadius: {
      version: 'blast-radius/1',
      sensitiveAreas: [
        { area: 'migrations', count: 1, paths: ['db/migrations/1.sql'] },
        { area: 'auth', count: 2, paths: ['src/auth/a.ts', 'src/auth/b.ts'] },
      ],
      teams: ['@acme/data'],
      individualOwners: 1,
      unownedPaths: 0,
      linkedTests: [],
      linkedTestsTotal: 0,
      truncated: true,
    },
    risk: {
      level: 'critical',
      score: 95,
      version: 'change-risk/1',
      factors: [
        {
          id: 'test-tampering',
          kind: 'risk',
          points: 40,
          detail: '1 change weakens the tests: an added skip or focus.',
          evidence: null,
        },
        {
          id: 'ai-authorship',
          kind: 'risk',
          points: 15,
          detail: 'Written by an agent (evil|bot`).',
          evidence: null,
        },
        {
          id: 'no-human-approval',
          kind: 'risk',
          points: 15,
          detail: 'AI-written and no person has approved it.',
          evidence: null,
        },
        {
          id: 'blast-radius',
          kind: 'risk',
          points: 20,
          detail: 'Touches 2 sensitive areas.',
          evidence: null,
        },
        { id: 'size', kind: 'risk', points: 5, detail: '400 lines changed.', evidence: null },
        {
          id: 'diff-coverage',
          kind: 'missing',
          points: 0,
          detail: 'Diff coverage was not measured.',
          evidence: null,
        },
      ],
      missing: ['diff-coverage'],
      ...overrides,
    },
  });

  it('leads with the change risk: the level, the top three factors, what was missing, and the reach', () => {
    const body = renderGateComment({ ...report, risk: assessed() });
    const lines = body.split('\n');
    const heading = lines.indexOf('**Change risk: Critical** · 95 points (`change-risk/1`)');
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(lines.indexOf('**Why the gate failed**'));
    expect(lines.slice(heading + 2, heading + 7)).toEqual([
      '| Points | Why |',
      '| ---: | --- |',
      '| 40 | 1 change weakens the tests: an added skip or focus. |',
      '| 15 | Written by an agent (evil bot ). |',
      '| 15 | AI-written and no person has approved it. |',
    ]);
    expect(body).toContain('…and 2 more on the dashboard.');
    expect(body).toContain('Not measured, so this cannot be low risk: diff coverage.');
    expect(body).toContain(
      'Reaches: migrations, auth · owned by @acme/data (changed files were truncated).',
    );
  });

  it('leaves the section out with no assessment, and lists no factors when there are none', () => {
    expect(renderGateComment(report)).not.toContain('Change risk');
    const calm = riskSection({
      ...assessed({ level: 'low', score: 0, factors: [], missing: [] }),
      blastRadius: null,
    });
    expect(calm).toEqual(['**Change risk: Low** · 0 points (`change-risk/1`)', '']);
  });

  const delivery = (status: Scorecard['status'], score: number | null): Scorecard => ({
    id: 'delivery',
    title: 'Software delivery (DORA)',
    dimension: 'delivery',
    evaluatedAt: '2026-10-23T12:00:00.000Z',
    windowDays: 30,
    status,
    score,
    cappedBy: score === null ? null : 'change-failure-rate',
    reasons: status === 'fail' ? ['Change failure rate is 30%.'] : [],
    metrics: [
      ['deployment-frequency', 'high'],
      ['change-lead-time', 'elite'],
      ['change-failure-rate', 'low'],
      ['failed-deployment-recovery-time', null],
      ['rework-rate', null],
    ].map(([key, band]) => ({
      key: key as string,
      label: key as string,
      value: band === null ? null : 1,
      unit: 'ratio' as const,
      direction: 'lower-better' as const,
      target: null,
      trend: null,
      sampleSize: 5,
      band: band ?? null,
      status: band === null ? ('insufficient' as const) : ('good' as const),
      summary: 's',
    })),
  });

  it('carries one DORA line when the delivery scorecard is measured', () => {
    const line = doraLine(delivery('fail', 52.4));
    expect(line).toBe(
      '**Delivery (DORA 2024):** 52.4 / 100, failing — deployment frequency high · lead time elite · change failure rate low · recovery time not enough data. Limited by change-failure-rate.',
    );
    const body = renderGateComment({ ...report, delivery: delivery('pass', 80) });
    expect(body.split('\n').filter((entry) => entry.startsWith('**Delivery'))).toHaveLength(1);
    expect(body).toContain('**Delivery (DORA 2024):** 80 / 100 — deployment frequency high');
  });

  it('leaves the DORA line out while there is too little data, or no scorecard', () => {
    expect(
      renderGateComment({ ...report, delivery: delivery('insufficient', null) }),
    ).not.toContain('DORA');
    expect(renderGateComment({ ...report, delivery: null })).not.toContain('DORA');
  });

  it('says which failures are quarantined, which are not, and which flaky tests nobody has', () => {
    const tests = {
      runId: 'r',
      total: 40,
      passed: 36,
      failed: 2,
      flaky: 2,
      reportErrors: 0,
      excused: false,
      quarantinedFailures: ['a.spec.ts › pays [webkit]'],
      failures: ['a.spec.ts › refunds`|'],
      flakyUnquarantined: ['b.spec.ts › lists'],
      unlabelledFailures: 0,
    };
    expect(testsSection(tests)).toEqual([
      '**Tests**',
      '',
      '40 tests: 36 passed, 2 failed, 2 flaky.',
      '- Failed: `a.spec.ts › refunds  `',
      '- Failed, quarantined: `a.spec.ts › pays [webkit]`',
      '- Flaky, not quarantined: `b.spec.ts › lists`',
    ]);
    const excused = testsSection({ ...tests, excused: true, failures: [], failed: 1 });
    expect(excused).toContain('- Failed, quarantined (excused): `a.spec.ts › pays [webkit]`');
    expect(testsSection({ ...tests, reportErrors: 2 })[3]).toBe(
      '- 2 error(s) outside the tests: nothing in this run is excused',
    );
    // One section in the comment, and none when there is no run for the commit.
    expect(renderGateComment({ ...report, tests })).toContain('**Tests**');
    expect(renderGateComment({ ...report, tests: null })).not.toContain('**Tests**');
    const many = testsSection({
      ...tests,
      failures: Array.from({ length: 12 }, (_, index) => `t${String(index)}`),
    });
    expect(many[3]).toMatch(/…and 2 more$/u);
    expect(testsSection({ ...tests, unlabelledFailures: 3 }).at(-1)).toBe(
      '- 3 failure(s) whose cause has no triage label',
    );
  });

  it('creates the comment the first time and updates it after', async () => {
    const first = fakeAdapter({ listIssueComments: [{ id: 1, body: 'unrelated' }] });
    expect(
      await reportToGitHub(
        first.adapter,
        't',
        { owner: 'o', repo: 'r', sha: 'abc1234', pullRequest: 7 },
        report,
      ),
    ).toEqual({ status: true, comment: 'created' });
    expect(first.requests.map((request) => request.operation)).toEqual([
      'createCommitStatus',
      'listIssueComments',
      'createIssueComment',
    ]);
    expect(first.requests[0]?.input).toMatchObject({
      sha: 'abc1234',
      state: 'failure',
      context: 'lupin/health',
    });

    const again = fakeAdapter({ listIssueComments: [{ id: 42, body: `${COMMENT_MARKER}\nold` }] });
    expect(
      (
        await reportToGitHub(
          again.adapter,
          't',
          { owner: 'o', repo: 'r', sha: 'abc1234', pullRequest: 7 },
          report,
        )
      ).comment,
    ).toBe('updated');
    expect(again.requests.at(-1)).toMatchObject({
      operation: 'updateIssueComment',
      input: { commentId: '42' },
    });
  });

  it('posts only the status without a pull request, and reports a refusal rather than throwing', async () => {
    const statusOnly = fakeAdapter({});
    expect(
      await reportToGitHub(
        statusOnly.adapter,
        't',
        { owner: 'o', repo: 'r', sha: 'abc1234' },
        { ...report, verdict: { ...report.verdict, verdict: 'passed', reasons: [] } },
      ),
    ).toEqual({ status: true, comment: 'skipped' });
    expect(statusOnly.requests[0]?.input).toMatchObject({
      state: 'success',
      description: 'Graded C',
    });
    const refused = fakeAdapter({}, ['createCommitStatus', 'listIssueComments']);
    expect(
      await reportToGitHub(
        refused.adapter,
        't',
        { owner: 'o', repo: 'r', sha: 'abc1234', pullRequest: 1 },
        report,
      ),
    ).toEqual({ status: false, comment: 'failed', error: 'github_403' });
  });
});

describe('alerts', () => {
  it('fires on a drop and on a new critical, on the default branch only', () => {
    expect(
      alertsFor({
        previous: { letter: 'B' },
        current: grade('C'),
        added: [],
        onDefaultBranch: true,
      }),
    ).toEqual([
      {
        kind: 'grade-dropped',
        from: 'B',
        to: 'C',
        limiter: 'Limited by Security — 1 high open from semgrep',
      },
    ]);
    expect(
      alertsFor({
        previous: { letter: 'C' },
        current: grade('C'),
        added: [],
        onDefaultBranch: true,
      }),
    ).toEqual([]);
    expect(
      alertsFor({
        previous: { letter: 'C' },
        current: grade('B'),
        added: [],
        onDefaultBranch: true,
      }),
    ).toEqual([]);
    expect(
      alertsFor({ previous: null, current: grade('F'), added: [], onDefaultBranch: true }),
    ).toEqual([]);
    expect(
      alertsFor({
        previous: { letter: 'A' },
        current: grade(null),
        added: [],
        onDefaultBranch: true,
      })[0],
    ).toMatchObject({ kind: 'grade-dropped', to: null });
    expect(
      alertsFor({
        previous: { letter: 'B' },
        current: grade('B'),
        added: [finding(), finding({ severity: 'high' })],
        onDefaultBranch: true,
      }),
    ).toEqual([
      {
        kind: 'new-critical',
        findings: [{ tool: 'semgrep', ruleId: 'sql-injection', path: 'src/db.ts', line: 12 }],
      },
    ]);
    expect(
      alertsFor({
        previous: { letter: 'B' },
        current: grade('F'),
        added: [finding()],
        onDefaultBranch: false,
      }),
    ).toEqual([]);
  });

  it('signs a webhook body so the receiver can check it', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    });
    const secret = 's'.repeat(40);
    const outcomes = await deliverAlerts(
      {
        webhookSecret: secret,
        fetch: fetcher as typeof fetch,
        now: () => new Date('2026-10-23T00:00:00.000Z'),
      },
      { webhookUrl: 'https://hooks.example.test/lupin' },
      {
        projectId: 'p',
        project: 'Service',
        branch: 'main',
        detailsUrl: null,
        alerts: [{ kind: 'new-critical', findings: [] }],
      },
    );
    expect(outcomes).toEqual(['webhook: 204']);
    const body = String(calls[0]?.init.body);
    const header = (calls[0]?.init.headers as Record<string, string>)['x-lupin-signature'];
    const unix = Math.floor(new Date('2026-10-23T00:00:00.000Z').getTime() / 1000);
    expect(header).toBe(
      `t=${String(unix)},v1=${createHmac('sha256', secret)
        .update(`${String(unix)}.${body}`)
        .digest('hex')}`,
    );
    expect(signWebhook(secret, body, unix)).toBe(header);
    expect(calls[0]?.init.redirect).toBe('error');
  });

  it('sends nothing unsigned, nothing to a refused URL, and posts to Slack when configured', async () => {
    const fetcher = vi.fn();
    const alerts = [
      { kind: 'grade-dropped' as const, from: 'B' as const, to: 'C' as const, limiter: 'x' },
    ];
    expect(
      await deliverAlerts(
        { fetch: fetcher as unknown as typeof fetch },
        { webhookUrl: 'https://hooks.example.test' },
        { projectId: 'p', project: 'S', branch: 'main', detailsUrl: null, alerts },
      ),
    ).toEqual([]);
    expect(
      await deliverAlerts(
        { webhookSecret: 's'.repeat(40), fetch: fetcher as unknown as typeof fetch },
        { webhookUrl: 'https://127.0.0.1/x' },
        { projectId: 'p', project: 'S', branch: 'main', detailsUrl: null, alerts },
      ),
    ).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    const slack = fakeAdapter({});
    const outcomes = await deliverAlerts(
      { slack: { adapter: slack.adapter, token: 'xoxb' } },
      { slackChannel: '#quality' },
      {
        projectId: 'p',
        project: 'Service',
        branch: 'main',
        detailsUrl: 'https://a.test/r',
        alerts,
      },
    );
    expect(outcomes).toEqual(['slack grade-dropped: sent']);
    expect(slack.requests[0]?.input).toEqual({
      channel: '#quality',
      text: 'Service: health fell from B to C. x https://a.test/r',
    });
  });
});

describe('isAllowedWebhook', () => {
  it.each([
    ['https://hooks.slack.com/services/x', true],
    ['https://example.com/hook', true],
    ['http://example.com/hook', false],
    ['https://localhost/hook', false],
    ['https://127.0.0.1/hook', false],
    ['https://10.1.2.3/hook', false],
    ['https://172.20.0.1/hook', false],
    ['https://192.168.1.1/hook', false],
    ['https://169.254.169.254/latest', false],
    ['https://[::1]/hook', false],
    ['https://user:pass@example.com/hook', false],
    ['https://metadata.internal/x', false],
    ['not a url', false],
    // The boundaries of each refused range, from both sides.
    ['https://172.15.255.255/hook', true],
    ['https://172.16.0.1/hook', false],
    ['https://172.31.255.255/hook', false],
    ['https://172.32.0.1/hook', true],
    ['https://169.253.1.1/hook', true],
    ['https://169.254.0.1/hook', false],
    ['https://0.0.0.0/hook', false],
    ['https://11.0.0.1/hook', true],
    ['https://192.167.1.1/hook', true],
    ['https://api.localhost/hook', false],
    ['https://user@example.com/hook', false],
    ['https://[fc00::1]/hook', false],
    ['https://[fd12:3456::1]/hook', false],
    ['https://[fe80::1]/hook', false],
    ['https://[2001:db8::1]/hook', true],
    ['ftp://example.com/hook', false],
  ])('%s → %s', (url, allowed) => {
    expect(isAllowedWebhook(url)).toBe(allowed);
  });
});

describe('what a delivery reports when it cannot deliver', () => {
  const event = {
    projectId: 'p',
    project: 'Service',
    branch: 'main',
    detailsUrl: 'https://a.test/r',
    alerts: [
      {
        kind: 'new-critical' as const,
        findings: [
          { tool: 'semgrep', ruleId: 'r1', path: null, line: null },
          { tool: 'semgrep', ruleId: 'r2', path: 'src/a.ts', line: 3 },
        ],
      },
    ],
  };

  it('names a webhook failure rather than throwing, for an Error and for anything else', async () => {
    const transport = (fail: () => never) => ({
      webhookSecret: 's'.repeat(40),
      fetch: (async () => fail()) as unknown as typeof fetch,
    });
    expect(
      await deliverAlerts(
        transport(() => {
          throw new Error('connect ECONNREFUSED');
        }),
        { webhookUrl: 'https://hooks.example.test/x' },
        event,
      ),
    ).toEqual(['webhook: connect ECONNREFUSED']);
    expect(
      await deliverAlerts(
        transport(() => {
          throw 'not an error';
        }),
        { webhookUrl: 'https://hooks.example.test/x' },
        event,
      ),
    ).toEqual(['webhook: failed']);
  });

  it('names the Slack refusal, and words a critical with no path and with several findings', async () => {
    const slack = fakeAdapter({}, ['postMessage']);
    expect(
      await deliverAlerts(
        { slack: { adapter: slack.adapter, token: 'xoxb' } },
        { slackChannel: '#quality' },
        event,
      ),
    ).toEqual(['slack new-critical: github_403']);
    expect(slack.requests[0]?.input).toEqual({
      channel: '#quality',
      text: 'Service: 2 new critical findings — semgrep: r1. https://a.test/r',
    });
    const one = fakeAdapter({});
    await deliverAlerts(
      { slack: { adapter: one.adapter, token: 'xoxb' } },
      { slackChannel: '#quality' },
      {
        ...event,
        detailsUrl: null,
        alerts: [
          { kind: 'new-critical', findings: [{ tool: 't', ruleId: 'r', path: 'p.ts', line: 1 }] },
        ],
      },
    );
    expect(one.requests[0]?.input).toMatchObject({
      text: 'Service: 1 new critical finding — t: r in p.ts.',
    });
  });

  it('sends nothing when there is nothing to alert', async () => {
    const slack = fakeAdapter({});
    expect(
      await deliverAlerts(
        { slack: { adapter: slack.adapter, token: 'xoxb' } },
        { slackChannel: '#quality' },
        { ...event, alerts: [] },
      ),
    ).toEqual([]);
    expect(slack.requests).toEqual([]);
  });
});

describe('the gate status and comment when GitHub refuses part of it', () => {
  const report = {
    verdict: {
      verdict: 'passed' as const,
      reasons: [],
      newFindings: { critical: 0, high: 0, total: 0 },
    },
    grade: grade(null),
    added: [],
    branch: 'feature',
    detailsUrl: 'https://lupin.example/dashboard/repo/p',
  };
  const target = { owner: 'o', repo: 'r', sha: 'abc1234', pullRequest: 3 };

  it('describes an incomplete grade, and links the status to the dashboard', async () => {
    const github = fakeAdapter({ listIssueComments: [] });
    await reportToGitHub(github.adapter, 't', target, report);
    expect(github.requests[0]?.input).toMatchObject({
      description: 'Grade incomplete',
      target_url: 'https://lupin.example/dashboard/repo/p',
    });
  });

  it('reports a failed comment write with its code, and a status refusal without a pull request', async () => {
    const writeRefused = fakeAdapter({ listIssueComments: [] }, ['createIssueComment']);
    expect(await reportToGitHub(writeRefused.adapter, 't', target, report)).toEqual({
      status: true,
      comment: 'failed',
      error: 'github_403',
    });
    const statusRefused = fakeAdapter({}, ['createCommitStatus']);
    expect(
      await reportToGitHub(
        statusRefused.adapter,
        't',
        { owner: 'o', repo: 'r', sha: 'abc1234' },
        report,
      ),
    ).toEqual({ status: false, comment: 'skipped', error: 'github_403' });
  });

  it('creates a comment when the listing is not one it can read', async () => {
    const unreadable = fakeAdapter({ listIssueComments: { not: 'a list' } });
    expect((await reportToGitHub(unreadable.adapter, 't', target, report)).comment).toBe('created');
  });
});

describe('the change-risk check run', () => {
  const risk: PullRequestRisk = {
    pullRequest: 3,
    headSha: 'abc1234',
    assessedAt: '2026-11-11T09:00:00.000Z',
    blastRadius: {
      version: 'blast-radius/1',
      sensitiveAreas: [{ area: 'auth', count: 1, paths: ['src/auth/login.ts'] }],
      teams: [],
      individualOwners: null,
      unownedPaths: null,
      linkedTests: [],
      linkedTestsTotal: 0,
      truncated: false,
    },
    risk: {
      level: 'high',
      score: 55,
      version: 'change-risk/1',
      factors: [
        { id: 'test-tampering', kind: 'risk', points: 40, detail: 'A skip.', evidence: null },
        { id: 'ai-authorship', kind: 'risk', points: 15, detail: 'Agent.', evidence: null },
      ],
      missing: [],
    },
  };
  const report = {
    verdict: {
      verdict: 'passed' as const,
      reasons: [],
      newFindings: { critical: 0, high: 0, total: 0 },
    },
    grade: grade('B'),
    added: [],
    branch: 'feature',
    detailsUrl: 'https://lupin.example/dashboard/prs/p/3',
    risk,
    tamperFindings: [
      {
        kind: 'skip-added' as const,
        path: 'src/auth/login.test.ts',
        line: 9,
        side: 'head' as const,
      },
      {
        kind: 'assertion-removed' as const,
        path: 'src/auth/login.test.ts',
        line: 4,
        side: 'base' as const,
      },
    ],
    diffCoverage: {
      commit: 'abc1234',
      branch: 'feature',
      changed: 4,
      covered: 1,
      executable: 4,
      ratio: 0.25,
      uncovered: [
        { path: 'src/auth/login.ts', lines: [3, 4, 5, 9] },
        { path: 'src/ui/button.ts', lines: [1] },
      ],
      unmeasuredFiles: [],
      computedAt: '2026-11-11T09:00:00.000Z',
    },
  } as GateReport;
  const target = { owner: 'o', repo: 'r', sha: 'abc1234', pullRequest: 3 };

  it('posts the status, creates the check run with the factors and annotations, then the comment', async () => {
    const github = fakeAdapter({ listCheckRuns: { items: [] }, listIssueComments: [] });
    expect(await reportToGitHub(github.adapter, 't', target, report)).toEqual({
      status: true,
      comment: 'created',
      check: 'created',
    });
    expect(github.requests.map((request) => request.operation)).toEqual([
      'createCommitStatus',
      'listCheckRuns',
      'createCheckRun',
      'listIssueComments',
      'createIssueComment',
    ]);
    expect(github.requests[0]?.input).toMatchObject({ description: 'Risk high · Graded B' });
    expect(github.requests[1]?.input).toMatchObject({ ref: 'abc1234', checkName: CHECK_RUN_NAME });
    const created = github.requests[2]?.input as Record<string, unknown>;
    expect(created).toMatchObject({
      name: CHECK_RUN_NAME,
      head_sha: 'abc1234',
      status: 'completed',
      // A high risk the policy only reports: neither green nor red.
      conclusion: 'neutral',
      external_id: '3:abc1234',
      details_url: 'https://lupin.example/dashboard/prs/p/3',
      output: { title: 'Change risk: high · 55 points' },
    });
    expect((created['output'] as { summary: string }).summary).toContain('| 40 | A skip. |');
    expect((created['output'] as { annotations: unknown[] }).annotations).toEqual([
      expect.objectContaining({
        path: 'src/auth/login.test.ts',
        start_line: 9,
        annotation_level: 'failure',
      }),
      expect.objectContaining({ path: 'src/auth/login.ts', start_line: 3, end_line: 5 }),
      expect.objectContaining({ path: 'src/auth/login.ts', start_line: 9, end_line: 9 }),
    ]);
  });

  it('updates the head’s check run rather than adding a second one', async () => {
    const github = fakeAdapter({
      listCheckRuns: {
        items: [
          { id: 77, name: CHECK_RUN_NAME },
          { id: 8, name: 'other' },
        ],
      },
      listIssueComments: [],
    });
    expect((await reportToGitHub(github.adapter, 't', target, report)).check).toBe('updated');
    expect(github.requests[2]).toMatchObject({
      operation: 'updateCheckRun',
      input: { checkRunId: '77', conclusion: 'neutral' },
    });
  });

  it('keeps the status and the comment when the token cannot write check runs', async () => {
    const github = fakeAdapter({ listIssueComments: [] }, ['listCheckRuns']);
    expect(await reportToGitHub(github.adapter, 't', target, report)).toEqual({
      status: true,
      comment: 'created',
      check: 'unavailable',
      error: 'github_403',
    });
    expect(github.requests.map((request) => request.operation)).not.toContain('createCheckRun');
  });

  it('calls a refused write unavailable and any other failure failed, and fails a failing gate', async () => {
    const refused = fakeAdapter({ listCheckRuns: { items: [] } }, ['createCheckRun']);
    const failedGate = {
      ...report,
      verdict: { ...report.verdict, verdict: 'failed' as const, reasons: ['Risk.'] },
    };
    expect(
      (
        await reportToGitHub(
          refused.adapter,
          't',
          { ...target, pullRequest: undefined },
          failedGate,
        )
      ).check,
    ).toBe('unavailable');
    expect(refused.requests[2]?.input).toMatchObject({ conclusion: 'failure' });
    const broken: ConnectorAdapter = {
      manifest: { name: 'fake', version: '1', operations: {} },
      execute: async (request) =>
        request.operation === 'listCheckRuns'
          ? {
              status: 'error',
              error: { code: 'github_502', retryable: true, message: 'x' },
              attempts: 3,
            }
          : { status: 'ok', data: [], attempts: 1 },
    };
    expect(
      await reportToGitHub(broken, 't', { ...target, pullRequest: undefined }, report),
    ).toEqual({
      status: true,
      comment: 'skipped',
      check: 'failed',
      error: 'github_502',
    });
  });

  it('posts no check run without an assessment, and caps the annotations GitHub accepts', async () => {
    const github = fakeAdapter({ listIssueComments: [] });
    const result = await reportToGitHub(github.adapter, 't', target, { ...report, risk: null });
    expect(result).not.toHaveProperty('check');
    const many = riskAnnotations({
      ...report,
      tamperFindings: Array.from({ length: MAX_ANNOTATIONS + 5 }, (_, line) => ({
        kind: 'skip-added' as const,
        path: 'a.test.ts',
        line: line + 1,
        side: 'head' as const,
      })),
    });
    expect(many).toHaveLength(MAX_ANNOTATIONS);
  });

  it('hands a job the same status, check run and comment the server would have posted', async () => {
    const github = fakeAdapter({ listCheckRuns: { items: [] }, listIssueComments: [] });
    await reportToGitHub(github.adapter, 't', target, report);
    const payload = githubPayload(target, report);
    const posted = (operation: string) =>
      github.requests.find((request) => request.operation === operation)?.input as Record<
        string,
        unknown
      >;
    expect({ owner: 'o', repo: 'r', sha: 'abc1234', ...payload.status }).toEqual(
      posted('createCommitStatus'),
    );
    expect({ owner: 'o', repo: 'r', head_sha: 'abc1234', ...payload.checkRun }).toEqual(
      posted('createCheckRun'),
    );
    expect(payload.comment).toEqual({
      marker: COMMENT_MARKER,
      body: posted('createIssueComment')['body'],
    });
    expect(payload.sha).toBe('abc1234');
  });

  it('leaves out the check run without an assessment and the comment without a pull request', () => {
    const payload = githubPayload({ sha: 'abc1234' }, { ...report, risk: null });
    expect(payload).toMatchObject({ checkRun: null, comment: null });
    expect(JSON.stringify(payload)).not.toMatch(/token/iu);
  });
});

describe('the diff-coverage line of the gate comment', () => {
  it('collapses consecutive lines into ranges', () => {
    expect(lineRanges([9, 3, 4, 5, 5, 11, 12])).toEqual(['3-5', '9', '11-12']);
    expect(lineRanges([])).toEqual([]);
  });

  it('lists at most ten uncovered ranges, and says how many more there are', () => {
    const uncovered = Array.from({ length: 12 }, (_, index) => ({
      path: `src/f${String(index)}.ts`,
      lines: [1],
    }));
    const line = diffCoverageLine({
      covered: 8,
      executable: 20,
      ratio: 0.4,
      uncovered,
      unmeasuredFiles: [],
      computedAt: '2026-10-23T12:00:00.000Z',
    });
    expect(line).toContain('**Diff coverage:** 40.0% — 8 of 20 changed executable lines ran.');
    expect(line).toContain('`src/f9.ts:1`, …and 2 more.');
    expect(line).not.toContain('src/f10.ts');
  });

  it('says there is nothing to measure when no changed line is executable', () => {
    expect(
      diffCoverageLine({
        covered: 0,
        executable: 0,
        ratio: null,
        uncovered: [],
        unmeasuredFiles: ['README.md'],
        computedAt: '2026-10-23T12:00:00.000Z',
      }),
    ).toMatch(/nothing to measure/u);
  });
});

describe('the AI governance section of the gate comment', () => {
  const plain = {
    verdict: {
      verdict: 'passed' as const,
      reasons: [],
      newFindings: { critical: 0, high: 0, total: 0 },
    },
    grade: grade('B'),
    added: [],
    branch: 'feature/x',
    detailsUrl: null,
  };
  const check = (extra: Partial<AiGovernanceCheck> = {}): AiGovernanceCheck => ({
    pullRequest: 7,
    synced: true,
    attribution: 'agent-authored',
    agent: 'claude-code',
    confidence: 0.95,
    signals: [{ kind: 'bot-login', detail: 'author claude[bot] is claude-code' }],
    unknownReason: null,
    verdict: {
      applies: true,
      verdict: 'fail',
      reasons: [
        'Agent-authored change by claude-code needs at least one human approval; it has none.',
      ],
      attributionNote: null,
    },
    ...extra,
  });

  it('shows the attribution, its confidence and signals, the verdict and each reason', () => {
    const body = renderGateComment({ ...plain, aiGovernance: check() });
    expect(body).toContain('**AI governance**');
    expect(body).toContain(
      'Attribution: agent-authored (claude-code), 95% confidence — author claude[bot] is claude-code.',
    );
    expect(body).toContain('Rules: failed.');
    expect(body).toContain(
      '- Agent-authored change by claude-code needs at least one human approval; it has none.',
    );
  });

  it('says why attribution is unknown for a pull request the sync never read, with the note', () => {
    const lines = aiGovernanceSection(
      check({
        synced: false,
        attribution: 'unknown',
        agent: null,
        confidence: 0,
        signals: [],
        unknownReason: 'Delivery sync is off for this project.',
        verdict: {
          applies: false,
          verdict: 'not-applicable',
          reasons: [],
          attributionNote: 'Attribution was unknown; the change was treated as human.',
        },
      }),
    );
    expect(lines).toEqual([
      '**AI governance**',
      '',
      'Attribution: unknown, 0% confidence.',
      '',
      '_Delivery sync is off for this project._',
      '',
      'Rules: not applicable — the rules govern AI-written change only.',
      '',
      '_Attribution was unknown; the change was treated as human._',
    ]);
  });

  it('keeps a label’s text from breaking the Markdown, and shows at most five signals', () => {
    const signals = Array.from({ length: 7 }, (_, index) => ({
      kind: 'label' as const,
      detail: `label "a|b\`${String(index)}" marks agent-authored change`,
    }));
    const [, , line] = aiGovernanceSection(check({ signals }));
    expect(line).not.toMatch(/[|`]/u);
    expect(line).toContain('…and 2 more');
  });

  it('has no section when the rules were not read', () => {
    expect(renderGateComment(plain)).not.toContain('AI governance');
  });
});

describe('the Evals section of the gate comment', () => {
  const suites = [
    {
      suite: 'support|bot',
      verdict: 'fail' as const,
      reasons: ['Pass rate fell.'],
      regressions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      flaky: ['h'],
      commitSha: 'abc1234',
      fellBack: false,
    },
    {
      suite: 'router',
      verdict: 'insufficient' as const,
      reasons: [],
      regressions: [],
      flaky: [],
      commitSha: null,
      fellBack: false,
    },
  ];
  const reading = (gateOnEvals: boolean, list = suites) => ({
    gateOnEvals,
    suites: list,
    commit: null,
    onDefaultBranch: false,
  });

  it('names each suite with its verdict, its significant regressions and its flaky cases', () => {
    expect(evalsSection(reading(true))).toEqual([
      '**Evals**',
      '',
      '- `support bot`: failed',
      '  - Significant regressions: `a`, `b`, `c`, `d`, `e` …and 2 more',
      '  - Flaky: `h`',
      '- `router`: not enough attempts to tell',
    ]);
  });

  it('says when the policy only reports evals, and appears in the comment only with a suite', () => {
    expect(evalsSection(reading(false))[2]).toContain('Reported only');
    const base = {
      verdict: {
        verdict: 'passed' as const,
        reasons: [],
        newFindings: { critical: 0, high: 0, total: 0 },
      },
      grade: grade('B'),
      added: [],
      branch: 'feature',
      detailsUrl: null,
    };
    expect(renderGateComment({ ...base, evals: reading(true) })).toContain('**Evals**');
    expect(renderGateComment({ ...base, evals: reading(true, []) })).not.toContain('**Evals**');
    expect(renderGateComment(base)).not.toContain('**Evals**');
  });

  it('names a missing suite, one with no baseline, and a run read from another commit', () => {
    const lines = evalsSection({
      gateOnEvals: true,
      commit: 'ccccccc3',
      onDefaultBranch: false,
      suites: [
        {
          suite: 'planner',
          verdict: 'missing',
          reasons: [],
          regressions: [],
          flaky: [],
          commitSha: null,
          fellBack: false,
        },
        {
          suite: 'support',
          verdict: 'no-baseline',
          reasons: [],
          regressions: [],
          flaky: [],
          commitSha: 'bbbbbbb2',
          fellBack: true,
        },
      ],
    });
    expect(lines.slice(2)).toEqual([
      '- `planner`: runs on the default branch, not run on this branch',
      '- `support`: no baseline on the default branch',
      "  - No run on `ccccccc3`; fell back to the branch's latest run (`bbbbbbb2`)",
    ]);
  });
});
