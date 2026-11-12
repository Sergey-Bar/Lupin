import React from 'react';
import { ExternalLink } from '@lupin/ui';
import type { Cockpit } from '@lupin/shared-contracts';
import { safeHref } from './Cockpit.js';
import { Panel } from './kit.js';

/**
 * Pull requests worth a person's look, each with the one fact that put it here. Not a score:
 * with nothing matched the section says so, and says what it reads, so an empty list is not
 * mistaken for a clean bill of health on a project whose pull requests were never synced.
 */
export function RiskSection({ risks }: { risks: Cockpit['risks'] }): React.ReactElement {
  return (
    <Panel title="Worth a look" data-testid="cockpit-risks">
      {risks.total === 0 ? (
        <p className="text-sm text-fg-muted">
          No pull request matched. This reads synced pull requests only; if none are synced, nothing
          was checked.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {risks.items.map((item) => {
              const href = safeHref(item.url);
              const name = `#${String(item.number)} ${item.title}`;
              return (
                <li
                  key={`${item.kind}:${String(item.number)}`}
                  className="flex flex-col gap-0.5 border-t border-border pt-2 text-sm"
                >
                  {href === null ? (
                    <span className="text-fg">{name}</span>
                  ) : (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      {name}
                      <ExternalLink size={12} aria-hidden="true" />
                      <span className="sr-only"> (opens GitHub in a new tab)</span>
                    </a>
                  )}
                  <span className="text-xs text-fg-muted">{item.detail}</span>
                </li>
              );
            })}
          </ul>
          {risks.total > risks.items.length ? (
            <p className="mt-2 text-xs text-fg-muted">
              Showing the newest {risks.items.length} of {risks.total}.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
