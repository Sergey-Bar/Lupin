import React from 'react';
import { createHealthClient, type WhoAmI } from '../lib/health-client.js';
import type { ViewerRole } from '../route-manifest.js';

/**
 * The signed-in caller's role, read once and shared.
 *
 * Used to decide which tabs to *draw* — never what is allowed, which the API enforces. The
 * read is cached at the module so the several places that want the role (the Settings tab
 * row, and anything else that gates a control) share one request rather than each issuing
 * their own. A failure resolves to `null` ("nobody") so a control is hidden rather than
 * offered to a caller who would be refused; the page behind it still renders through its own
 * gate, matching `SessionGate`'s fail-open-for-rendering rule.
 */
let cached: Promise<WhoAmI | null> | null = null;

function readWhoAmI(): Promise<WhoAmI | null> {
  if (cached === null) {
    cached = createHealthClient()
      .whoami()
      .catch(() => null);
  }
  return cached;
}

/** Test seam: drop the cached read so a test starts from a known state. */
export function resetViewerRoleCache(): void {
  cached = null;
}

export function useViewerRole(): ViewerRole | null {
  const [role, setRole] = React.useState<ViewerRole | null>(null);
  React.useEffect(() => {
    let live = true;
    void readWhoAmI().then((who) => {
      if (live) setRole(who?.role ?? null);
    });
    return () => {
      live = false;
    };
  }, []);
  return role;
}
