import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePagedList } from './usePagedList.js';

/** A promise the test settles by hand, so the order responses arrive in is the test's choice. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Page = { items: string[]; nextCursor: string | null };

describe('usePagedList', () => {
  it('loads the first page, then appends the next one on loadMore', async () => {
    const calls: Array<string | undefined> = [];
    const { result } = renderHook(() =>
      usePagedList<string>(async (cursor) => {
        calls.push(cursor);
        return cursor === undefined
          ? { items: ['a'], nextCursor: 'c1' }
          : { items: ['b'], nextCursor: null };
      }, []),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => {
      if (result.current.status === 'ready') result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.status === 'ready' && result.current.items).toEqual(['a', 'b']);
    });
    expect(calls).toEqual([undefined, 'c1']);
    expect(result.current.status === 'ready' && result.current.hasMore).toBe(false);
  });

  it('asks for a page once however many times loadMore is called while it is in flight', async () => {
    const second = deferred<Page>();
    let calls = 0;
    const { result } = renderHook(() =>
      usePagedList<string>((cursor) => {
        calls += 1;
        return cursor === undefined
          ? Promise.resolve({ items: ['a'], nextCursor: 'c1' })
          : second.promise;
      }, []),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => {
      if (result.current.status !== 'ready') return;
      result.current.loadMore();
      result.current.loadMore();
    });
    expect(calls).toBe(2);
    await act(async () => {
      second.resolve({ items: ['b'], nextCursor: null });
      await second.promise;
    });
  });

  it('throws away a first page that arrives after the filter moved on', async () => {
    const slow = deferred<Page>();
    const { result, rerender } = renderHook(
      ({ filter }: { filter: string }) =>
        usePagedList<string>(
          () =>
            filter === 'old' ? slow.promise : Promise.resolve({ items: ['new'], nextCursor: null }),
          [filter],
        ),
      { initialProps: { filter: 'old' } },
    );
    rerender({ filter: 'new' });
    await waitFor(() =>
      expect(result.current.status === 'ready' && result.current.items).toEqual(['new']),
    );
    await act(async () => {
      slow.resolve({ items: ['old'], nextCursor: null });
      await slow.promise;
    });
    expect(result.current.status === 'ready' && result.current.items).toEqual(['new']);
  });

  it('throws away a failure that belongs to a filter that is gone', async () => {
    const slow = deferred<Page>();
    const { result, rerender } = renderHook(
      ({ filter }: { filter: string }) =>
        usePagedList<string>(
          () =>
            filter === 'old' ? slow.promise : Promise.resolve({ items: ['new'], nextCursor: null }),
          [filter],
        ),
      { initialProps: { filter: 'old' } },
    );
    rerender({ filter: 'new' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      slow.reject(new Error('late'));
      await slow.promise.catch(() => undefined);
    });
    expect(result.current.status).toBe('ready');
  });

  it('ignores a next page, and a failed one, once the filter has changed', async () => {
    const lateOk = deferred<Page>();
    const lateFail = deferred<Page>();
    let which: 'ok' | 'fail' = 'ok';
    const { result, rerender } = renderHook(
      ({ filter }: { filter: string }) =>
        usePagedList<string>(
          (cursor) => {
            if (cursor === undefined) {
              return Promise.resolve({
                items: [filter],
                nextCursor: filter === 'one' ? 'c' : null,
              });
            }
            return which === 'ok' ? lateOk.promise : lateFail.promise;
          },
          [filter],
        ),
      { initialProps: { filter: 'one' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => {
      if (result.current.status === 'ready') result.current.loadMore();
    });
    rerender({ filter: 'two' });
    await waitFor(() =>
      expect(result.current.status === 'ready' && result.current.items).toEqual(['two']),
    );
    await act(async () => {
      lateOk.resolve({ items: ['stale'], nextCursor: null });
      await lateOk.promise;
    });
    expect(result.current.status === 'ready' && result.current.items).toEqual(['two']);

    which = 'fail';
    rerender({ filter: 'one' });
    await waitFor(() =>
      expect(result.current.status === 'ready' && result.current.items).toEqual(['one']),
    );
    act(() => {
      if (result.current.status === 'ready') result.current.loadMore();
    });
    rerender({ filter: 'two' });
    await waitFor(() =>
      expect(result.current.status === 'ready' && result.current.items).toEqual(['two']),
    );
    await act(async () => {
      lateFail.reject(new Error('too late'));
      await lateFail.promise.catch(() => undefined);
    });
    expect(result.current.status === 'ready' && result.current.moreError).toBeNull();
  });

  it('reports the API detail when there is one, and the message when there is not', async () => {
    const withDetail = renderHook(() =>
      usePagedList<string>(async () => {
        throw Object.assign(new Error('Bad Gateway'), { detail: 'GitHub is down' });
      }, []),
    );
    await waitFor(() =>
      expect(withDetail.result.current).toEqual({ status: 'error', message: 'GitHub is down' }),
    );
    const plain = renderHook(() =>
      usePagedList<string>(async () => {
        throw new Error('boom');
      }, []),
    );
    await waitFor(() => expect(plain.result.current).toEqual({ status: 'error', message: 'boom' }));
    const notAnError = renderHook(() =>
      usePagedList<string>(() => Promise.reject('plain string'), []),
    );
    await waitFor(() =>
      expect(notAnError.result.current).toEqual({ status: 'error', message: 'plain string' }),
    );
  });
});
