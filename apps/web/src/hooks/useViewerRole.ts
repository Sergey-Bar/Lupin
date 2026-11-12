import React from 'react';
import { createHealthClient, type WhoAmI } from '../lib/health-client.js';
import { QaApiError } from '../lib/qa-client.js';
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
 *
 * **A failure is reported, not only absorbed** (ledger MNT-187). Being signed out (401, 403)
 * is an answer and reads as no role. Anything else — the API down, a contract mismatch — is
 * `failed`, so the sidebar can say why the admin pages are missing and offer a retry, which
 * re-reads for every component holding the role.
 */
interface RoleRead {
  who: WhoAmI | null;
  failed: boolean;
}

let cached: Promise<RoleRead> | null = null;
const listeners = new Set<() => void>();

function signedOut(error: unknown): boolean {
  return error instanceof QaApiError && (error.status === 401 || error.status === 403);
}

function readWhoAmI(): Promise<RoleRead> {
  if (cached === null) {
    cached = createHealthClient()
      .whoami()
      .then(
        (who) => ({ who, failed: false }),
        (error: unknown) => ({ who: null, failed: !signedOut(error) }),
      );
  }
  return cached;
}

/** Test seam: drop the cached read so a test starts from a known state. */
export function resetViewerRoleCache(): void {
  cached = null;
}

function retryViewerRole(): void {
  cached = null;
  for (const listener of listeners) listener();
}

export interface ViewerRoleRead {
  role: ViewerRole | null;
  /** The read failed for a reason other than being signed out. */
  failed: boolean;
  /** The read has answered, either way. */
  settled: boolean;
  retry: () => void;
}

export function useViewerRoleRead(): ViewerRoleRead {
  const [state, setState] = React.useState<Omit<ViewerRoleRead, 'retry'>>({
    role: null,
    failed: false,
    settled: false,
  });
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    const listener = () => setVersion((count) => count + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  React.useEffect(() => {
    let live = true;
    void readWhoAmI().then((read) => {
      if (live) setState({ role: read.who?.role ?? null, failed: read.failed, settled: true });
    });
    return () => {
      live = false;
    };
  }, [version]);
  return { ...state, retry: retryViewerRole };
}

export function useViewerRole(): ViewerRole | null {
  return useViewerRoleRead().role;
}
