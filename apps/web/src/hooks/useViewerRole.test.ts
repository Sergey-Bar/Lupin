/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetViewerRoleCache, useViewerRole } from './useViewerRole.js';

afterEach(() => {
  resetViewerRoleCache();
  vi.unstubAllGlobals();
});

describe('useViewerRole', () => {
  it('reports the signed-in role when whoami answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ actor: 'you', role: 'admin', mode: 'enforced' }), {
            status: 200,
          }),
      ),
    );
    const { result } = renderHook(() => useViewerRole());
    await waitFor(() => expect(result.current).toBe('admin'));
  });

  it('reports no role — never throws — when whoami cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const { result } = renderHook(() => useViewerRole());
    // The failure resolves to null (nobody), so a control is hidden rather than offered.
    await waitFor(() => expect(result.current).toBeNull());
  });
});
