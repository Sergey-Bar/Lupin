import React from 'react';
import { isNothingYet } from '../lib/nothing-yet.js';
import { Button, Checkbox } from '@lupin/ui';
import type { PagedList } from '../hooks/usePagedList.js';
import type { Resource } from '../hooks/useResource.js';
import { useResource } from '../hooks/useResource.js';
import type { ActionKind, Subject } from '../lib/github-actions.js';
import type { HealthClient } from '../lib/health-client.js';
import { canOperate } from '../lib/roles.js';
import { Panel, Quiet } from './kit.js';

/**
 * The pieces the pull request and issue inbox share.
 *
 * Both pages had the same selection, the same "load more" footer, the same loading, error and
 * empty panels, and the same who-may-write check, written twice. Written twice they drifted and
 * grew into two functions of 47 and 48 in the complexity gate; written once, each page is the
 * part that differs: which filters it has and what a row says.
 */

/** Whether the caller may write. Absent `health` is a read-only page, not an unknown role. */
export function useOperator(health: HealthClient | undefined): boolean {
  const who = useResource(
    (_signal) => (health === undefined ? Promise.resolve(null) : health.whoami()),
    [health],
  );
  return who.status === 'ready' && who.value !== null && canOperate(who.value);
}

/** The rows ticked for a bulk action, by `subjectKey`. */
export interface Selection {
  has: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Tick or clear every key in `keys` at once ("select all shown"). */
  setAll: (keys: readonly string[], on: boolean) => void;
  clear: () => void;
}

export function useSelection(): Selection {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  return React.useMemo(
    () => ({
      has: (key) => selected.has(key),
      toggle: (key) =>
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }),
      setAll: (keys, on) => setSelected(on ? new Set(keys) : new Set()),
      clear: () => setSelected(new Set()),
    }),
    [selected],
  );
}

/** The write a person picked, and the rows it applies to; `null` when no dialog is open. */
export type PendingAction = { kind: ActionKind; subjects: readonly Subject[] } | null;

/** True when any of `texts` contains `needle` (already lower-cased); an empty needle matches. */
export function matchesQuery(needle: string, texts: readonly (string | null)[]): boolean {
  if (needle === '') return true;
  return texts.some((text) => (text ?? '').toLowerCase().includes(needle));
}

/** The tick box beside one row. */
export function RowCheckbox({
  label,
  rowKey,
  selection,
}: {
  label: string;
  rowKey: string;
  selection: Selection;
}): React.ReactElement {
  return (
    <Checkbox
      aria-label={`Select ${label}`}
      checked={selection.has(rowKey)}
      onChange={() => selection.toggle(rowKey)}
    />
  );
}

/** "Select all shown", over the rows that survive the filters. */
export function SelectAllShown({
  keys,
  selection,
  label = 'Select all shown',
}: {
  keys: readonly string[];
  selection: Selection;
  /** What the box is called, for assistive technology and for the person reading it. */
  label?: string;
}): React.ReactElement {
  return (
    <label className="mb-2 flex shrink-0 items-center gap-3 ps-3 text-xs text-fg-muted">
      <Checkbox
        aria-label={label}
        checked={keys.every((key) => selection.has(key))}
        onChange={(event) => selection.setAll(keys, event.target.checked)}
      />
      {label}
    </label>
  );
}

/** A failed "more" and the button for the next page, under the list. */
export function LoadMoreFooter({
  list,
}: {
  list: Extract<PagedList<unknown>, { status: 'ready' }>;
}): React.ReactElement {
  return (
    <>
      {list.moreError === null ? null : (
        <p role="alert" className="mt-2 text-sm text-danger">
          Could not load more: {list.moreError}
        </p>
      )}
      {list.hasMore ? (
        <div className="mt-2">
          <Button variant="outline" disabled={list.loadingMore} onClick={list.loadMore}>
            {list.loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** True when no repository is being read, which is why an empty inbox is empty. */
function nothingIsSynced(repos: Resource<{ items: readonly { syncEnabled: boolean }[] }>): boolean {
  return repos.status === 'ready' && repos.value.items.every((repo) => !repo.syncEnabled);
}

/** What a loading, failing or empty list needs to know; both a paged list and a resource fit. */
type ListState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

/**
 * The panel for a list that is loading, failed, or has nothing to show; `null` when it has rows.
 *
 * A function returning an element rather than a component, so a page can write
 * `notice ?? <the list>` and the rows are never built for an empty list.
 */
export function inboxNotice({
  list,
  repos,
  noun,
  total,
  shown,
  empty,
}: {
  list: ListState;
  /** Whether any repository is being read, which is why an inbox can be empty. */
  repos?: Resource<{ items: readonly { syncEnabled: boolean }[] }>;
  /** Plural, as the panel title says it: "Pull requests", "Issues". */
  noun: string;
  /** How many the server returned, before the page's own filters. */
  total: number;
  /** How many survive the filters. */
  shown: number;
  /** The sentence for an empty list, when it is not about the sync being off. */
  empty?: string;
}): React.ReactElement | null {
  if (list.status === 'loading') {
    return (
      <Panel title={noun} className="flex-1">
        <Quiet role="status">Loading…</Quiet>
      </Panel>
    );
  }
  if (list.status === 'error') {
    return (
      <Panel title={noun} className="flex-1">
        <Quiet role={isNothingYet(list.message) ? undefined : 'alert'}>
          {isNothingYet(list.message)
            ? 'GitHub is not connected yet. Connect it in Settings to see pull requests and issues here.'
            : `Could not load this: ${list.message}`}
        </Quiet>
      </Panel>
    );
  }
  if (shown > 0) return null;
  const lower = noun.toLowerCase();
  const syncOff = total === 0 && repos !== undefined && nothingIsSynced(repos);
  const sentence =
    empty ??
    (syncOff
      ? `${noun} appear once a repository is being read. Turn on the sync for a project under Repositories.`
      : `No ${lower} match.`);
  return (
    <Panel title={`0 ${lower}`} className="flex-1">
      <Quiet>{sentence}</Quiet>
    </Panel>
  );
}
