import React from 'react';
import type { HealthClient } from '../lib/health-client.js';
import { PageGuide } from './PageGuide.js';
import { SessionGate } from './SessionGate.js';

/**
 * The page body: its guide and the page itself, both behind the sign-in gate.
 *
 * The guide sat outside the gate, so a signed-out caller saw "How to use Runs" above
 * the sign-in field for a page they could not open. It also stays outside
 * `[data-page]`: `j` and `k` walk the list rows inside that element, and the guide's
 * steps are a list.
 */
export function PageContent({
  health,
  pathname,
  children,
}: {
  health: HealthClient;
  pathname: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <SessionGate health={health} bypass={pathname === '/dashboard/pair'}>
      {/*
       * One relative wrapper holds the guide and the page, so `<main>`'s first child is a
       * region with the real content in it rather than the guide's zero-height box. The guide
       * is absolutely positioned against this wrapper exactly as it was against `<main>`, so it
       * still sits as an icon in the padding above the page — but a route with no tab row no
       * longer presents an empty first child to anything checking that it rendered (the
       * route-level accessibility gate did, and failed on every such detail page). The guide
       * stays outside `[data-page]`, so `j`/`k` still walk only the page's own list rows.
       */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <PageGuide pathname={pathname} />
        <div data-page className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </div>
    </SessionGate>
  );
}
