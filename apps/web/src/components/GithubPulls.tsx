import React from 'react';
import { Badge, Button, CircleAlert, CircleCheck, Input, Timer } from '@lupin/ui';
import type { GithubPullItem } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import { usePagedList } from '../hooks/usePagedList.js';
import { subjectOfPull, type ActionKind, type Subject } from '../lib/github-actions.js';
import type { GithubClient } from '../lib/github-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { canOperate } from '../lib/roles.js';
import {
  bucketOf,
  countBuckets,
  sortByAttention,
  statusOf,
  type Bucket,
} from '../lib/github-view.js';
import { formatRelative } from '../lib/intl.js';
import { Bdi, UserText } from './Bidi.js';
import { PageFrame, Panel, Quiet, Segmented } from './kit.js';
import { RepositoryFilter } from './GithubShared.js';
import { GithubActionDialog } from './GithubActionDialog.js';
import { BulkBar, subjectKey } from './GithubActionControls.js';
import { PullDetail } from './GithubPullDetail.js';
import { MasterDetail } from './MasterDetail.js';

/**
 * Open pull requests across every repository, ranked by what the reader can do with them:
 * what can be merged, then what is stuck, then what waits.
 *
 * The rows come from the database the sync fills, so opening this page spends no GitHub
 * request budget. A title or an author can be in any script: `UserText` gives it the direction
 * its own first letters say, while a repository, branch or number is an identifier and stays
 * left to right.
 */
type StateFilter = 'open' | 'closed' | 'merged' | 'all';
type BucketFilter = 'all' | Exclude<Bucket, 'done'>;

const STATES = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'merged', label: 'Merged' },
  { value: 'all', label: 'All' },
] as const;

const BUCKET_LABELS = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'draft', label: 'Drafts' },
] as const;

const STATUS_ICON = { ready: CircleCheck, blocked: CircleAlert, waiting: Timer } as const;

export function PullRequestsPage({
  github,
  health,
  initialProjectId,
  now = () => new Date(),
}: {
  github: GithubClient;
  /** Present: the page offers writes to an operator. Absent: it is read-only. */
  health?: HealthClient | undefined;
  /** A repository to start filtered to, from a link on the repository page. */
  initialProjectId?: string | undefined;
  now?: () => Date;
}): React.ReactElement {
  const [state, setState] = React.useState<StateFilter>('open');
  const [projectId, setProjectId] = React.useState(initialProjectId ?? '');
  const [bucket, setBucket] = React.useState<BucketFilter>('all');
  const [query, setQuery] = React.useState('');
  const [version, setVersion] = React.useState(0);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = React.useState<{
    kind: ActionKind;
    subjects: readonly Subject[];
  } | null>(null);
  const repos = useResource((_signal) => github.listRepos(), [github]);
  const who = useResource(
    (_signal) => (health === undefined ? Promise.resolve(null) : health.whoami()),
    [health],
  );
  const operator = who.status === 'ready' && who.value !== null && canOperate(who.value);
  const list = usePagedList(
    (cursor) =>
      github.listPulls({
        state,
        projectId: projectId === '' ? undefined : projectId,
        limit: 50,
        cursor,
      }),
    [github, state, projectId, version],
  );

  const items = list.status === 'ready' ? list.items : [];
  const counts = countBuckets(items);
  // Buckets only describe open work, so a closed or merged view is never narrowed by one.
  const activeBucket = state === 'open' ? bucket : 'all';
  const needle = query.trim().toLowerCase();
  const shown = sortByAttention(items).filter((item) => {
    if (activeBucket !== 'all' && bucketOf(item) !== activeBucket) return false;
    if (needle === '') return true;
    return [item.title, item.author ?? '', item.repository].some((text) =>
      text.toLowerCase().includes(needle),
    );
  });

  return (
    <PageFrame>
      <h1 className="sr-only">Pull requests</h1>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {state === 'open' ? (
          <Segmented
            label="Show"
            options={BUCKET_LABELS.map((option) => ({
              value: option.value,
              label:
                option.value === 'all'
                  ? option.label
                  : `${option.label} ${String(counts[option.value === 'draft' ? 'draft' : option.value])}`,
            }))}
            value={bucket}
            onChange={setBucket}
          />
        ) : null}
        <Segmented label="State" options={STATES} value={state} onChange={setState} />
        <div className="flex flex-wrap items-center gap-3 sm:ms-auto">
          <RepositoryFilter
            id="pulls-repository"
            repos={repos}
            value={projectId}
            onChange={setProjectId}
          />
          <div className="w-64">
            <Input
              aria-label="Search"
              placeholder="Title, author or repository"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      </div>
      {operator ? (
        <BulkBar
          subjects={shown.filter((item) => selected.has(subjectKey(item))).map(subjectOfPull)}
          onPick={(kind, subjects) => setPending({ kind, subjects })}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      {list.status === 'loading' ? (
        <Panel title="Pull requests" className="flex-1">
          <Quiet role="status">Loading…</Quiet>
        </Panel>
      ) : list.status === 'error' ? (
        <Panel title="Pull requests" className="flex-1">
          <Quiet role="alert">Could not load this: {list.message}</Quiet>
        </Panel>
      ) : shown.length === 0 ? (
        <Panel title="0 pull requests" className="flex-1">
          <Quiet>
            {items.length === 0 &&
            repos.status === 'ready' &&
            repos.value.items.every((r) => !r.syncEnabled)
              ? 'Pull requests appear once a repository is being read. Turn on the sync for a project under Repositories.'
              : 'No pull requests match.'}
          </Quiet>
        </Panel>
      ) : (
        <MasterDetail
          label="pull requests"
          title={`${String(shown.length)} ${shown.length === 1 ? 'pull request' : 'pull requests'}`}
          items={shown}
          getKey={subjectKey}
          rowPx={64}
          renderRow={(item) => <PullRowSummary item={item} now={now()} />}
          renderLead={
            operator
              ? (item) => (
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.repository}#${String(item.number)}`}
                    checked={selected.has(subjectKey(item))}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        const key = subjectKey(item);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  />
                )
              : undefined
          }
          listHeader={
            operator ? (
              <label className="mb-2 flex shrink-0 items-center gap-3 ps-3 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={shown.every((item) => selected.has(subjectKey(item)))}
                  onChange={(event) =>
                    setSelected(event.target.checked ? new Set(shown.map(subjectKey)) : new Set())
                  }
                />
                Select all shown
              </label>
            ) : undefined
          }
          footer={
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
          }
          renderDetail={(item) => (
            <PullDetail
              item={item}
              now={now()}
              operator={operator}
              onPick={(kind, subject) => setPending({ kind, subjects: [subject] })}
            />
          )}
        />
      )}
      {pending === null ? null : (
        <GithubActionDialog
          kind={pending.kind}
          subjects={pending.subjects}
          github={github}
          now={now}
          onClose={() => setPending(null)}
          onDone={() => {
            setSelected(new Set());
            setVersion((current) => current + 1);
          }}
        />
      )}
    </PageFrame>
  );
}

/** The one-line summary a row carries: what it is, who and when, and its status at the end. */
function PullRowSummary({ item, now }: { item: GithubPullItem; now: Date }): React.ReactElement {
  const status = statusOf(item);
  const Icon =
    status.bucket in STATUS_ICON ? STATUS_ICON[status.bucket as keyof typeof STATUS_ICON] : null;
  return (
    <span data-testid="pull-row" className="flex h-full min-w-0 items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <UserText className="truncate font-medium">{item.title}</UserText>
        <span className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
          <Bdi className="truncate font-mono">
            {item.repository}#{String(item.number)}
          </Bdi>
          {item.author === null ? null : <Bdi className="truncate">{item.author}</Bdi>}
          <span className="whitespace-nowrap">{formatRelative(item.lastActivityAt, now)}</span>
        </span>
      </span>
      <Badge variant={status.tone} className="shrink-0 gap-1 whitespace-nowrap">
        {Icon === null ? null : <Icon size={12} aria-hidden="true" />}
        {status.headline}
      </Badge>
    </span>
  );
}
