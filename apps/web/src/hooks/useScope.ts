import React from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { routeFor } from '../route-manifest.js';
import { isScopedPage, resolveScope, SCOPE_EVENT, writeScope } from '../lib/scope.js';

/**
 * The project scope, for any component under the router: the address's `?project=`, else
 * the reader's last choice, else every project (`undefined`).
 *
 * An address that names a project makes it the choice, so a link someone sent is what the
 * next page opens on too. `choose` remembers the choice and, on a page that reads
 * `?project=`, rewrites the address in place.
 */
export function useScope(): {
  projectId: string | undefined;
  choose: (next: string | undefined) => void;
} {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const fromAddress =
    typeof location.search === 'object' &&
    location.search !== null &&
    typeof (location.search as Record<string, unknown>)['project'] === 'string'
      ? ((location.search as Record<string, unknown>)['project'] as string)
      : undefined;
  const [, heard] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => {
    window.addEventListener(SCOPE_EVENT, heard);
    return () => window.removeEventListener(SCOPE_EVENT, heard);
  }, []);
  const projectId = resolveScope(fromAddress);
  React.useEffect(() => {
    if (fromAddress !== undefined && projectId !== undefined) writeScope(projectId);
  }, [fromAddress, projectId]);
  const pathname = location.pathname;
  const choose = React.useCallback(
    (next: string | undefined) => {
      writeScope(next);
      if (!isScopedPage(routeFor(pathname)?.id)) return;
      void router.navigate({
        to: pathname,
        search: next === undefined ? {} : { project: next },
        replace: true,
      });
    },
    [router, pathname],
  );
  return { projectId, choose };
}
