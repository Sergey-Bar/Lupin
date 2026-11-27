import { describe, expect, it, vi } from 'vitest';
import { getPulse } from './pulse-client.js';

const body = {
  projectId: 'p 1',
  evaluatedAt: '2026-11-26T12:00:00.000Z',
  windowDays: 14,
  direction: 'steady',
  confidence: 'high',
  cause: null,
  sentence: 'Steady: Nothing moved past its noise across 4 signs.',
  vitals: [],
  alsoMoved: [],
};

describe('getPulse', () => {
  it('asks for the project and window, and parses against the server schema', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const pulse = await getPulse('p 1', 14, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/projects/p%201/pulse?days=14', {
      credentials: 'same-origin',
    });
    expect(pulse.direction).toBe('steady');
  });

  it('refuses an answer that is not a pulse', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ direction: 'great' }), { status: 200 }),
    );
    await expect(getPulse('p1', 7, fetcher as unknown as typeof fetch)).rejects.toMatchObject({
      detail: expect.stringMatching(/did not match the expected shape/u) as unknown,
    });
  });
});
