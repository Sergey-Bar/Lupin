import React from 'react';
import type { GithubPullItem } from '@lupin/shared-contracts';
import { AreaPage, type AreaItem } from './AreaPage.js';
import { useResource } from '../hooks/useResource.js';
import { pullItems } from '../lib/attention.js';
import { isNothingYet } from '../lib/nothing-yet.js';

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
  const verdict =
    pulls.status === 'loading'
      ? 'Reading the open pull requests…'
      : pulls.status === 'error'
        ? isNothingYet(pulls.message)
          ? 'GitHub is not connected yet.'
          : `Could not read the pull requests: ${pulls.message}`
        : items.length === 0
          ? 'Nothing is stuck. Every open pull request is moving.'
          : `${String(items.length)} ${items.length === 1 ? 'pull request is' : 'pull requests are'} stuck.`;
  return (
    <AreaPage
      title="Delivery"
      verdict={verdict}
      items={items}
      navigate={navigate}
      clear="No pull request needs you."
      details={details}
    />
  );
}
