import React from 'react';
import { Skeleton } from '@lupin/ui';

/**
 * A page component loaded when its route is first opened, not with the application.
 *
 * Every screen used to be imported by its route file, so the first bundle carried all forty of
 * them: 1,123 KB on 2026-11-04 against 734 KB when the rendering ceilings were recorded, and a
 * long task on every route's first load that the recorded bundle did not have. The four routes
 * the rendering budget measures stay in the first bundle (a lazy page would add a round trip
 * before their first paint); everything else comes through here.
 *
 * The fallback is what a reader sees for the moment the chunk is in flight: a named, busy status
 * with a skeleton the height of a page header, so the layout does not jump and a screen reader is
 * told something is loading rather than nothing.
 *
 * @param load the dynamic import of the module that exports the page
 * @param name the export to render
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
): M[K] {
  const Lazy = React.lazy(async () => ({
    default: (await load())[name] as React.ComponentType<object>,
  }));
  function LazyPage(props: object): React.ReactElement {
    return (
      <React.Suspense fallback={<PageLoading />}>
        <Lazy {...props} />
      </React.Suspense>
    );
  }
  LazyPage.displayName = `Lazy(${name})`;
  return LazyPage as M[K];
}

function PageLoading(): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Loading"
      aria-busy="true"
      data-testid="page-loading"
      className="flex flex-col gap-4"
    >
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
