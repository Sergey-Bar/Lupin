import { describe, expect, it, vi } from 'vitest';
import { cockpitFixture } from '../test-utils.js';
import { cockpitPath, createCockpitClient } from './cockpit-client.js';
import { QaApiError } from './qa-client.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('cockpitPath', () => {
  it('always names the window and adds the project and branch only when asked', () => {
    expect(cockpitPath({ window: '7d' })).toBe('/api/v1/cockpit?window=7d');
    expect(cockpitPath({ window: 'release', projectId: 'p-1', branch: 'main' })).toBe(
      '/api/v1/cockpit?window=release&projectId=p-1&branch=main',
    );
  });

  it('encodes what a person typed rather than splicing it into the address', () => {
    const path = cockpitPath({ window: '7d', branch: 'feature/a&b=c' });
    expect(path).toBe('/api/v1/cockpit?window=7d&branch=feature%2Fa%26b%3Dc');
  });
});

describe('createCockpitClient', () => {
  it('asks with the session cookie and returns the parsed payload', async () => {
    const fetchImpl = vi.fn(async () => json(cockpitFixture()));
    const cockpit = await createCockpitClient('http://api.test', fetchImpl).getCockpit({
      window: '7d',
    });
    expect(cockpit.overall.score).toBe(74);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/api/v1/cockpit?window=7d',
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
  });

  it('passes the abort signal on, so a screen that left can cancel the read', async () => {
    const fetchImpl = vi.fn(async () => json(cockpitFixture()));
    const controller = new AbortController();
    await createCockpitClient('', fetchImpl).getCockpit({ window: '7d' }, controller.signal);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('refuses a body that is not the contract, instead of drawing it', async () => {
    const fetchImpl = vi.fn(async () => json({ headline: 'Everything is fine' }));
    await expect(
      createCockpitClient('', fetchImpl).getCockpit({ window: '7d' }),
    ).rejects.toBeInstanceOf(QaApiError);
  });

  it('carries the server\u2019s own sentence for a failure', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { code: 'NOT_FOUND', message: 'This workspace has no project to show' } }, 404),
    );
    await expect(
      createCockpitClient('', fetchImpl).getCockpit({ window: '7d' }),
    ).rejects.toMatchObject({
      status: 404,
      detail: expect.stringContaining('no project'),
    });
  });
});
