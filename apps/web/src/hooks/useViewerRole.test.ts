/// <reference types="vitest/globals" />
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetViewerRoleCache, useViewerRole, useViewerRoleRead } from './useViewerRole.js';

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

  /*
   * A failed read said nothing (ledger MNT-187): the admin pages left the sidebar and the
   * palette as if the caller were a viewer. Signed out is an answer; a failure is not.
   */
  it('says a read failed, and a retry recovers the role', async () => {
    let answer = (): Response => new Response('nope', { status: 500 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer()),
    );
    const { result } = renderHook(() => useViewerRoleRead());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.role).toBeNull();
    answer = () =>
      new Response(JSON.stringify({ actor: 'you', role: 'admin', mode: 'enforced' }), {
        status: 200,
      });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.role).toBe('admin'));
    expect(result.current.failed).toBe(false);
  });

  it('does not call being signed out a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const { result } = renderHook(() => useViewerRoleRead());
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current).toMatchObject({ role: null, failed: false });
  });
});
