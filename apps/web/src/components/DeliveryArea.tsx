import React from 'react';
import { Hero } from '@lupin/ui';
import type { GithubPullItem } from '@lupin/shared-contracts';
import { AreaPage, type AreaItem } from './AreaPage.js';
import { areaHero } from '../lib/hero.js';
import { useResource } from '../hooks/useResource.js';
import { pullItems } from '../lib/attention.js';
import { isNothingYet } from '../lib/nothing-yet.js';

const DELIVERY_PAGES: ReadonlyArray<readonly [string, string]> = [
  ['Pull requests', '/dashboard/prs'],
  ['Issues', '/dashboard/issues'],
  ['Repositories', '/dashboard/repos'],
  ['AI code', '/dashboard/ai-code'],
  ['Agents', '/dashboard/agents'],
];

/** The one sentence the Delivery page leads with, for each state of the pull-request read. */
function deliveryVerdict(
  pulls: ReturnType<typeof useResource<{ items: GithubPullItem[] }>>,
  stuck: number,
): string {
  if (pulls.status === 'loading') return 'Reading the open pull requests…';
  if (pulls.status === 'error') {
    return isNothingYet(pulls.message)
      ? 'GitHub is not connected yet.'
      : `Could not read the pull requests: ${pulls.message}`;
  }
  if (pulls.value.items.length === 0) {
    return 'No open pull requests yet. Connect GitHub in Settings to watch them here.';
  }
  if (stuck === 0) return 'Nothing is stuck. Every open pull request is moving.';
  return `${String(stuck)} ${stuck === 1 ? 'pull request is' : 'pull requests are'} stuck.`;
}

function DeliveryHero({
  items,
  open,
  verdict,
}: {
  items: AreaItem[];
  open: number;
  verdict: string;
}): React.ReactElement {
  const band = areaHero(
    {
      bad: items.filter((item) => item.tone === 'bad').length,
      warn: items.filter((item) => item.tone === 'warn').length,
    },
    verdict,
  );
  return (
    <Hero
      headingLevel={2}
      verdict={band.verdict}
      word={band.word}
      reason={band.reason}
      eyebrow="Open pull requests"
      facts={[
        { label: 'Stuck', value: String(items.length) },
        { label: 'Open', value: String(open) },
      ]}
    />
  );
}

/**
 * The Delivery area: which pull requests are stuck and why, first; every pull request, issue
 * and repository list is under Details for the reader who wants the whole inbox.
 */
export function DeliveryArea({
  listPulls,
  details,
  navigate,
}: {
  listPulls: () => Promise<{ items: GithubPullItem[] }>;
  details: React.ReactNode;
  navigate: (to: string) => void;
}): React.ReactElement {
  const pulls = useResource(() => listPulls(), [listPulls]);
  const items: AreaItem[] =
    pulls.status === 'ready'
      ? pullItems(pulls.value.items).map((item) => ({
          id: item.id,
          title: item.title,
          detail: item.detail,
          tone: item.severity === 'bad' ? 'bad' : 'warn',
          at: item.at,
          action: item.action,
        }))
      : [];
  const verdict = deliveryVerdict(pulls, items.length);
  return (
    <AreaPage
      title="Delivery"
      subtitle={
        // Every Delivery page in one quiet line: the More menu is a shortcut, not the only way in.
        <nav aria-label="Delivery pages" className="flex flex-wrap gap-x-4 gap-y-1">
          {DELIVERY_PAGES.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="inline-flex min-h-6 items-center rounded-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              {label}
            </a>
          ))}
        </nav>
      }
      verdict={verdict}
      {...(pulls.status === 'ready' && pulls.value.items.length > 0
        ? {
            hero: <DeliveryHero items={items} open={pulls.value.items.length} verdict={verdict} />,
          }
        : {})}
      items={items}
      navigate={navigate}
      clear={
        // Only a read that succeeded can say nothing needs you; a failed or pending one cannot.
        pulls.status === 'ready'
          ? 'No pull request needs you.'
          : pulls.status === 'loading'
            ? 'Checking…'
            : 'Lupin will check again when you reload.'
      }
      details={details}
    />
  );
}
