import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_AUTH_HEADERS, API_BASE, REPORTER_AUTH_HEADERS, WEB_BASE } from '../support/config.js';
import { authenticate } from '../support/session.js';
import { registerTempProject, type TempProject } from '../support/temp-project.js';

/**
 * Release journey 4 (`docs/quality/release-journeys.json`, `ai-signals`): the signals a QA
 * lead needs when agents write the code — an eval suite that regressed on a branch, the agent
 * configuration a repository ships, and an honest answer about who wrote a change.
 *
 * The eval verdict is the formula's (`compareEvalRuns`, ten decided attempts minimum): ten
 * passes on main against ten failures on the branch is a significant regression, and with the
 * project's checked-in policy gating on evals, the branch's gate fails on it.
 */

function evalRun(passed: boolean, attempts = 10): string {
  return JSON.stringify({
    tool: { name: 'lupin', version: null },
    suite: 'refund-agent',
    model: null,
    provider: null,
    configHash: 'cfg-1',
    truncated: false,
    totals: {
      cases: 1,
      attempts,
      passed: passed ? attempts : 0,
      failed: passed ? 0 : attempts,
      errors: 0,
      tokensInput: null,
      tokensOutput: null,
      costUsd: null,
      meanLatencyMs: null,
    },
    cases: [
      {
        caseId: 'refunds-a-damaged-order',
        label: 'Refunds a damaged order',
        promptHash: null,
        prompt: null,
        attempts: Array.from({ length: attempts }, (_, epoch) => ({
          epoch,
          passed,
          error: null,
          scores: [],
          latencyMs: null,
          tokensInput: null,
          tokensOutput: null,
          costUsd: null,
        })),
      },
    ],
  });
}

async function uploadEval(
  request: APIRequestContext,
  projectId: string,
  branch: string,
  body: string,
) {
  const response = await request.post(
    `${API_BASE}/api/v1/projects/${projectId}/health/reports?format=lupin-eval-json&branch=${encodeURIComponent(branch)}`,
    { headers: { ...REPORTER_AUTH_HEADERS, 'content-type': 'application/json' }, data: body },
  );
  expect(response.status(), await response.text()).toBe(201);
}

test.describe('AI-era signals', () => {
  let project: TempProject;

  test.beforeEach(async ({ request }) => {
    project = await registerTempProject(request, 'lupin-ai', undefined, {
      'lupin.config.json': JSON.stringify({
        version: 1,
        health: { agents: { gateOnEvals: true } },
      }),
    });
  });

  test.afterEach(async ({ request }) => project.remove(request));

  test('an eval suite that regressed on a branch fails that branch, and the gate says which', async ({
    page,
    context,
    request,
  }) => {
    await uploadEval(request, project.id, 'main', evalRun(true));
    await uploadEval(request, project.id, 'feat/refund-prompt', evalRun(false));

    const evals = (await (
      await request.get(
        `${API_BASE}/api/v1/projects/${project.id}/evals?branch=feat/refund-prompt`,
        {
          headers: API_AUTH_HEADERS,
        },
      )
    ).json()) as {
      defaultBranch: string;
      suites: Array<{
        suite: string;
        comparison: {
          verdict: string;
          overall: { change: string };
          regressions: Array<{ caseId: string; significant: boolean }>;
        } | null;
      }>;
    };
    expect(evals.defaultBranch).toBe('main');
    const suite = evals.suites.find((entry) => entry.suite === 'refund-agent');
    expect(suite?.comparison).toMatchObject({ verdict: 'fail', overall: { change: 'lower' } });
    expect(suite?.comparison?.regressions).toEqual([
      expect.objectContaining({ caseId: 'refunds-a-damaged-order', significant: true }),
    ]);

    const gate = await request.post(
      `${API_BASE}/api/v1/projects/${project.id}/health/gate/report`,
      {
        headers: { ...REPORTER_AUTH_HEADERS, 'content-type': 'application/json' },
        data: { branch: 'feat/refund-prompt', commit: 'abc1234' },
      },
    );
    expect(gate.status(), await gate.text()).toBe(200);
    const verdict = (await gate.json()) as { verdict: string; reasons: string[] };
    expect(verdict.verdict).toBe('failed');
    expect(verdict.reasons.some((reason) => reason.startsWith('Evals (refund-agent):'))).toBe(true);

    // Too few attempts to tell a regression from noise is said, not passed.
    await uploadEval(request, project.id, 'feat/tiny', evalRun(true, 3));
    const tiny = (await (
      await request.get(`${API_BASE}/api/v1/projects/${project.id}/evals?branch=feat/tiny`, {
        headers: API_AUTH_HEADERS,
      })
    ).json()) as { suites: Array<{ comparison: { verdict: string; reasons: string[] } | null }> };
    expect(tiny.suites[0]?.comparison?.verdict).toBe('insufficient');

    await authenticate(context, request);
    await page.addInitScript((id) => window.localStorage.setItem('lupin-project', id), project.id);
    await page.goto(`${WEB_BASE}/dashboard/agents`);
    await expect(page.getByTestId('eval-runs')).toContainText('refund-agent', { timeout: 15_000 });
  });

  test('the agent configuration a repository ships is scanned, and an unpinned MCP server is named', async ({
    page,
    context,
    request,
  }) => {
    const files = [
      {
        path: '.mcp.json',
        text: JSON.stringify({
          mcpServers: { browser: { command: 'npx', args: ['-y', '@acme/browser-mcp'] } },
        }),
      },
      { path: 'AGENTS.md', text: '# Agents\n\nRun the tests before committing.\n' },
      { path: 'src/index.ts', text: 'export {};\n' },
    ];
    const post = () =>
      request.post(`${API_BASE}/api/v1/projects/${project.id}/health/agent-config`, {
        headers: { ...REPORTER_AUTH_HEADERS, 'content-type': 'application/json' },
        data: { branch: 'main', files },
      });
    const first = await post();
    expect(first.status(), await first.text()).toBe(201);
    expect(await first.json()).toMatchObject({
      branch: 'main',
      filesScanned: 2,
      ignored: 1,
      mcpServers: 1,
      findings: { new: 2 },
    });
    // The same files again are the same findings, not new ones.
    expect(await (await post()).json()).toMatchObject({ findings: { new: 0, persisting: 2 } });

    const servers = (await (
      await request.get(
        `${API_BASE}/api/v1/projects/${project.id}/agents/mcp-servers?branch=main`,
        {
          headers: API_AUTH_HEADERS,
        },
      )
    ).json()) as { servers: Array<{ name: string; pinned: boolean; configPath: string }> };
    expect(servers.servers).toEqual([
      expect.objectContaining({ name: 'browser', pinned: false, configPath: '.mcp.json' }),
    ]);

    await authenticate(context, request);
    await page.addInitScript((id) => window.localStorage.setItem('lupin-project', id), project.id);
    await page.goto(`${WEB_BASE}/dashboard/agents`);
    await expect(page.getByTestId('mcp-servers')).toContainText('browser', { timeout: 15_000 });
  });

  test('a project nothing has synced says attribution is unknown, never human', async ({
    request,
  }) => {
    const response = await request.get(
      `${API_BASE}/api/v1/projects/${project.id}/ai-code?days=30`,
      {
        headers: API_AUTH_HEADERS,
      },
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      scorecard: { metrics: Array<{ status: string; value: number | null }> };
    };
    // No metric claims a human share it never measured.
    for (const metric of body.scorecard.metrics) {
      expect(metric.status === 'ok' && metric.value !== null, JSON.stringify(metric)).toBe(false);
    }
  });
});
