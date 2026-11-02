import React from 'react';

interface PageOf<T> {
  items: T[];
  nextCursor: string | null;
}

export type PagedList<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      items: T[];
      hasMore: boolean;
      loadingMore: boolean;
      /** The reason the last "load more" failed, with the pages already shown kept. */
      moreError: string | null;
      loadMore: () => void;
    };

function messageOf(error: unknown): string {
  const detail = (error as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  return error instanceof Error ? error.message : String(error);
}

/**
 * A keyset-paged list: the first page when `deps` change, and the next one on `loadMore`.
 *
 * A change in `deps` (a filter) starts over and throws away what was loaded, so a page of the
 * old filter is never shown under the new one. A response that arrives after the filter moved
 * on, or after unmount, is ignored. A failed "load more" keeps the pages already shown and says
 * so, instead of replacing the list with an error.
 */
export function usePagedList<T>(
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<PageOf<T>>,
  deps: readonly unknown[],
): PagedList<T> {
  const [state, setState] = React.useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | {
        status: 'ready';
        items: T[];
        hasMore: boolean;
        loadingMore: boolean;
        moreError: string | null;
      }
  >({ status: 'loading' });
  const generation = React.useRef(0);
  const cursor = React.useRef<string | null>(null);
  const busy = React.useRef(false);
  const loader = React.useRef(load);
  loader.current = load;

  React.useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    const mine = generation.current;
    cursor.current = null;
    busy.current = false;
    setState({ status: 'loading' });
    loader
      .current(undefined, controller.signal)
      .then((page) => {
        if (generation.current !== mine) return;
        cursor.current = page.nextCursor;
        setState({
          status: 'ready',
          items: page.items,
          hasMore: page.nextCursor !== null,
          loadingMore: false,
          moreError: null,
        });
      })
      .catch((error: unknown) => {
        if (generation.current !== mine) return;
        setState({ status: 'error', message: messageOf(error) });
      });
    return () => {
      generation.current += 1;
      controller.abort();
    };
    // The caller's dependencies decide when to start over, as in `useResource`.
  }, deps);

  const loadMore = React.useCallback(() => {
    const after = cursor.current;
    if (after === null || busy.current) return;
    busy.current = true;
    const mine = generation.current;
    setState((current) =>
      current.status === 'ready' ? { ...current, loadingMore: true, moreError: null } : current,
    );
    loader
      .current(after, new AbortController().signal)
      .then((page) => {
        if (generation.current !== mine) return;
        busy.current = false;
        cursor.current = page.nextCursor;
        setState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                items: [...current.items, ...page.items],
                hasMore: page.nextCursor !== null,
                loadingMore: false,
                moreError: null,
              }
            : current,
        );
      })
      .catch((error: unknown) => {
        if (generation.current !== mine) return;
        busy.current = false;
        setState((current) =>
          current.status === 'ready'
            ? { ...current, loadingMore: false, moreError: messageOf(error) }
            : current,
        );
      });
  }, []);

  return state.status === 'ready' ? { ...state, loadMore } : state;
}
