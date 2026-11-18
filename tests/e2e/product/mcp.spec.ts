import { spawn } from 'node:child_process';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_AUTH_HEADERS, API_BASE, REPORTER_AUTH_HEADERS } from '../support/config.js';
import { registerTempProject, type TempProject } from '../support/temp-project.js';

/**
 * Release journey 7 (`docs/quality/release-journeys.json`, `mcp`): a developer's own agent asks
 * Lupin "is this branch safe to ship?" over MCP, through both doors — `POST /api/v1/mcp` and the
 * stdio proxy an MCP client launches (`apps/api/dist/mcp/stdio.js`). Only a viewer token is
 * needed, and an uploader token, which may only send reports, is refused.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const STDIO = path.join(REPO_ROOT, 'apps', 'api', 'dist', 'mcp', 'stdio.js');

async function mint(request: APIRequestContext, role: 'viewer' | 'uploader', projectId?: string) {
  const response = await request.post(`${API_BASE}/api/v1/access-tokens`, {
    headers: { ...API_AUTH_HEADERS, 'content-type': 'application/json' },
    data: { name: `mcp e2e ${role}`, role, expiresInDays: 1, ...(projectId ? { projectId } : {}) },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

function rpc(id: number, method: string, params: unknown = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

type ToolResult = {
  result?: { content: Array<{ type: string; text: string }>; isError?: boolean };
  error?: { code: number };
};

test.describe('the MCP server', () => {
  let project: TempProject;
  test.beforeEach(async ({ request }) => {
    project = await registerTempProject(request, 'lupin-mcp');
    // A gate an agent can read: a clean scan on main.
    const sarif = JSON.stringify({
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'semgrep', rules: [] } }, results: [] }],
    });
    const upload = await request.post(
      `${API_BASE}/api/v1/projects/${project.id}/health/reports?format=sarif&branch=main`,
      {
        headers: { ...REPORTER_AUTH_HEADERS, 'content-type': 'application/json' },
        data: sarif,
      },
    );
    expect(upload.status()).toBe(201);
  });
  test.afterEach(async ({ request }) => project.remove(request));

  test('over HTTP, a viewer lists the tools and reads the gate; an uploader token is refused', async ({
    request,
  }) => {
    const viewer = await mint(request, 'viewer');
    const call = (token: string, body: unknown) =>
      request.post(`${API_BASE}/api/v1/mcp`, {
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        data: body,
      });
    const listed = await call(viewer, rpc(1, 'tools/list'));
    expect(listed.status(), await listed.text()).toBe(200);
    const names = (
      (await listed.json()) as { result: { tools: Array<{ name: string }> } }
    ).result.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(['get_gate', 'list_runs', 'list_failure_causes', 'list_projects']),
    );

    const gate = (await (
      await call(
        viewer,
        rpc(2, 'tools/call', {
          name: 'get_gate',
          arguments: { projectId: project.id, branch: 'main' },
        }),
      )
    ).json()) as ToolResult;
    expect(gate.result?.isError ?? false).toBe(false);
    expect(gate.result?.content[0]?.text).toMatch(/^Gate passed on main/u);

    const uploader = await mint(request, 'uploader', project.id);
    const refused = await call(uploader, rpc(3, 'tools/list'));
    expect([401, 403]).toContain(refused.status());
  });

  test('through the stdio proxy an MCP client launches, the same question gets the same answer', async ({
    request,
  }) => {
    const viewer = await mint(request, 'viewer');
    const child = spawn(process.execPath, [STDIO], {
      env: { ...process.env, LUPIN_URL: API_BASE, LUPIN_TOKEN: viewer },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines: string[] = [];
    let buffered = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const parts = buffered.split('\n');
      buffered = parts.pop() ?? '';
      lines.push(...parts.filter((line) => line.trim() !== ''));
    });
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const answer = async (id: number) => {
      await expect
        .poll(() => lines.some((line) => (JSON.parse(line) as { id?: number }).id === id), {
          timeout: 15_000,
        })
        .toBe(true);
      return JSON.parse(
        lines.find((line) => (JSON.parse(line) as { id?: number }).id === id) ?? '{}',
      ) as ToolResult & {
        result?: { serverInfo?: { name: string } };
      };
    };
    try {
      send(
        rpc(1, 'initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '1' },
        }),
      );
      // The proxy answers the handshake itself, under its own name, and forwards the tools.
      expect((await answer(1)).result?.serverInfo?.name).toBe('lupin-stdio');
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send(
        rpc(2, 'tools/call', {
          name: 'get_gate',
          arguments: { projectId: project.id, branch: 'main' },
        }),
      );
      expect((await answer(2)).result?.content[0]?.text).toMatch(/^Gate passed on main/u);
    } finally {
      child.kill();
    }
  });
});
