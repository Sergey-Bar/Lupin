import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MCP_TOOLS } from './tools.js';

/**
 * Every MCP tool is called through `POST /api/v1/mcp` (plan 1795712849115 task 10).
 *
 * `routes/mcp.test.ts` drives the tools over Streamable HTTP with the real guard in front, which
 * is the path an editor takes. This keeps that true as tools are added: a tool the HTTP suite
 * never names is a tool whose JSON-RPC wiring, scope and contract parse were never exercised
 * by the transport a client uses.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const httpSuite = readFileSync(path.join(here, '..', 'routes', 'mcp.test.ts'), 'utf8');

describe('the MCP tools', () => {
  it.each(MCP_TOOLS.map((tool) => [tool.name]))('%s is called over HTTP', (name) => {
    expect(httpSuite).toContain(`'${name}'`);
  });

  it('the check can fail: a tool name the suite never uses is not found', () => {
    expect(httpSuite).not.toContain("'get_nothing_at_all'");
  });

  it('every tool has a description an assistant can choose by', () => {
    for (const tool of MCP_TOOLS) expect(tool.description.length).toBeGreaterThan(20);
  });
});
