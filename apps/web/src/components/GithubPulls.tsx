import React from 'react';
import {
  Badge,
  Button,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Timer,
} from '@lupin/ui';
import type { GithubPullItem } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import { usePagedList } from '../hooks/usePagedList.js';
import { subjectOfPull, type ActionKind, type Subject } from '../lib/github-actions.js';
import type { GithubClient } from '../lib/github-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { canOperate } from '../lib/roles.js';
import { bucketOf, countBuckets, sortByAttention, type Bucket } from '../lib/github-view.js';
import { formatRelative } from '../lib/intl.js';
import { Bdi, UserText } from './Bidi.js';
import { PageFrame, PageHeader, Panel, Quiet, Segmented } from './kit.js';
import { RepositoryFilter, Verdict } from './GithubShared.js';
import { GithubActionDialog } from './GithubActionDialog.js';
import { BulkBar, RowActions, subjectKey } from './GithubActionControls.js';
import { StatusLine } from './StatusLine.js';

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

const BUCKETS = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'draft', label: 'Drafts' },
] as const;

const REVIEW = {
  approved: { label: 'Approved', variant: 'success', Icon: CircleCheck },
  changes_requested: { label: 'Changes requested', variant: 'danger', Icon: CircleAlert },
  review_required: { label: 'Needs review', variant: 'outline', Icon: Timer },
} as const;

const CHECKS = {
  success: { label: 'Passing', variant: 'success', Icon: CircleCheck },
  failure: { label: 'Failing', variant: 'danger', Icon: CircleAlert },
  pending: { label: 'Running', variant: 'warning', Icon: Timer },
} as const;

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
  const needle = query.trim().toLowerCase();
  const shown = sortByAttention(items).filter((item) => {
    if (bucket !== 'all' && bucketOf(item) !== bucket) return false;
    if (needle === '') return true;
    return [item.title, item.author ?? '', item.repository].some((text) =>
      text.toLowerCase().includes(needle),
    );
  });

  return (
    <PageFrame>
      <PageHeader
        title="Pull requests"
        subtitle="Open pull requests across every repository, ranked by what you can do with them."
      />
      <StatusLine
        data-testid="pulls-status"
        value={String(counts.ready)}
        sentence={
          counts.ready === 1 ? 'pull request ready to merge' : 'pull requests ready to merge'
        }
        tone={counts.ready > 0 ? 'good' : counts.blocked > 0 ? 'bad' : 'caution'}
        action={
          counts.ready > 0 && bucket !== 'ready'
            ? { label: 'Show them', onSelect: () => setBucket('ready') }
            : undefined
        }
      />
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <Segmented label="State" options={STATES} value={state} onChange={setState} />
        <Segmented label="Show" options={BUCKETS} value={bucket} onChange={setBucket} />
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
      {operator ? (
        <BulkBar
          subjects={shown.filter((item) => selected.has(subjectKey(item))).map(subjectOfPull)}
          onPick={(kind, subjects) => setPending({ kind, subjects })}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      <Panel title="Pull requests" className="flex-1">
        {list.status === 'loading' ? (
          <Quiet role="status">Loading…</Quiet>
        ) : list.status === 'error' ? (
          <Quiet role="alert">Could not load this: {list.message}</Quiet>
        ) : shown.length === 0 ? (
          <Quiet>
            {items.length === 0 &&
            repos.status === 'ready' &&
            repos.value.items.every((r) => !r.syncEnabled)
              ? 'Pull requests appear once a repository is being read. Turn on the sync for a project under Repositories.'
              : 'No pull requests match.'}
          </Quiet>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {operator ? (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={
                          shown.length > 0 && shown.every((item) => selected.has(subjectKey(item)))
                        }
                        onChange={(event) =>
                          setSelected(
                            event.target.checked ? new Set(shown.map(subjectKey)) : new Set(),
                          )
                        }
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>Pull request</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead>Checks</TableHead>
                  <TableHead className="text-end">Size</TableHead>
                  <TableHead>Updated</TableHead>
                  {operator ? (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((item) => (
                  <PullRow
                    key={item.id}
                    item={item}
                    now={now()}
                    operator={operator}
                    selected={selected.has(subjectKey(item))}
                    onToggle={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        const key = subjectKey(item);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    onPick={(kind, subject) => setPending({ kind, subjects: [subject] })}
                  />
                ))}
              </TableBody>
            </Table>
            {list.moreError === null ? null : (
              <p role="alert" className="mt-2 text-sm text-danger">
                Could not load more: {list.moreError}
              </p>
            )}
            {list.hasMore ? (
              <div className="mt-3">
                <Button variant="outline" disabled={list.loadingMore} onClick={list.loadMore}>
                  {list.loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>
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

function PullRow({
  item,
  now,
  operator,
  selected,
  onToggle,
  onPick,
}: {
  item: GithubPullItem;
  now: Date;
  operator: boolean;
  selected: boolean;
  onToggle: () => void;
  onPick: (kind: ActionKind, subject: Subject) => void;
}): React.ReactElement {
  const subject = subjectOfPull(item);
  const review = item.reviewDecision === null ? null : REVIEW[item.reviewDecision];
  const checks = item.checksState === null ? null : CHECKS[item.checksState];
  return (
    <TableRow data-testid="pull-row">
      {operator ? (
        <TableCell>
          <input
            type="checkbox"
            aria-label={`Select ${item.repository}#${String(item.number)}`}
            checked={selected}
            onChange={onToggle}
          />
        </TableCell>
      ) : null}
      <TableCell className="max-w-[28rem]">
        <div className="flex min-w-0 flex-col gap-1">
          {item.htmlUrl === null ? (
            <UserText className="truncate font-medium">{item.title}</UserText>
          ) : (
            <a
              href={item.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${item.repository}#${String(item.number)} on GitHub`}
              className="inline-flex min-w-0 items-center gap-1 font-medium underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <UserText className="truncate">{item.title}</UserText>
              <ExternalLink size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
            </a>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <Bdi className="font-mono">
              {item.repository}#{String(item.number)}
            </Bdi>
            {item.headBranch === null ? null : <Bdi className="font-mono">{item.headBranch}</Bdi>}
            {item.draft ? <Badge variant="outline">Draft</Badge> : null}
            {item.mergeableState === 'dirty' ? <Badge variant="danger">Conflicts</Badge> : null}
            {item.mergeableState === 'behind' ? <Badge variant="outline">Behind base</Badge> : null}
            {item.labels.map((label) => (
              <Badge key={label} variant="secondary">
                <UserText>{label}</UserText>
              </Badge>
            ))}
          </div>
        </div>
      </TableCell>
      <TableCell>{item.author === null ? '—' : <Bdi>{item.author}</Bdi>}</TableCell>
      <TableCell>{review === null ? '—' : <Verdict entry={review} />}</TableCell>
      <TableCell>
        {checks === null ? (
          <span className="text-fg-muted">No checks</span>
        ) : (
          <Verdict entry={checks} />
        )}
      </TableCell>
      <TableCell className="text-end tabular-nums">
        <span className="text-success">+{item.additions}</span>{' '}
        <span className="text-danger">−{item.deletions}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-fg-muted">
        {formatRelative(item.lastActivityAt, now)}
      </TableCell>
      {operator ? (
        <TableCell>
          <RowActions subject={subject} onPick={onPick} />
        </TableCell>
      ) : null}
    </TableRow>
  );
}
