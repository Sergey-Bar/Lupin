import React from 'react';
import { useRouter } from '@tanstack/react-router';

/**
 * The in-app address a link points at, or `null` when the browser should follow it itself:
 * another origin, or the API (a download, an export, a report file).
 */
export function inAppHref(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Routes every plain click on a link to a page of this app through the router (ledger
 * MNT-186), so following a link keeps the app's state instead of reloading it. Mounted once, at
 * the root: a link written as `<a href>` or `ButtonLink` needs nothing of its own. A modified
 * or non-primary click, `target`, `download`, a fragment on the same page, another origin and
 * the API are left to the browser.
 */
export function useInAppLinks(): void {
  const router = useRouter({ warn: false });
  React.useEffect(() => {
    if (!router) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (anchor === null || anchor.hasAttribute('download')) return;
      if (anchor.target !== '' && anchor.target !== '_self') return;
      const raw = anchor.getAttribute('href');
      if (raw === null || raw.startsWith('#')) return;
      const href = inAppHref(anchor.href, window.location.origin);
      if (href === null) return;
      event.preventDefault();
      void router.navigate({ href });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [router]);
}
