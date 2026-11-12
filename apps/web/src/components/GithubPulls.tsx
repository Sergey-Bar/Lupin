import React from 'react';
import { Badge, CircleAlert, CircleCheck, Input, Timer } from '@lupin/ui';
import type { GithubPullItem } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import { usePagedList } from '../hooks/usePagedList.js';
import { subjectOfPull } from '../lib/github-actions.js';
import { RISK_BADGE, RISK_WORD, isHighRisk, pullRequestRiskPath } from '../lib/change-risk.js';
import type { GithubClient } from '../lib/github-client.js';
import type { HealthClient } from '../lib/health-client.js';
import {
  bucketOf,
  countBuckets,
  sortByAttention,
  statusOf,
  type Bucket,
} from '../lib/github-view.js';
import { formatRelative } from '../lib/intl.js';
import { Bdi, UserText } from './Bidi.js';
import { PageFrame, Segmented } from './kit.js';
import { RepositoryFilter } from './GithubShared.js';
import { GithubActionDialog } from './GithubActionDialog.js';
import { BulkBar, subjectKey } from './GithubActionControls.js';
import {
  LoadMoreFooter,
  RowCheckbox,
  SelectAllShown,
  inboxNotice,
  matchesQuery,
  useOperator,
  useSelection,
  type PendingAction,
} from './GithubInboxParts.js';
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

type RiskFilter = 'all' | 'high';

/** The "Risk" filter: every pull request, or those assessed high or critical at their head. */
function riskOptions(high: number) {
  return [
    { value: 'all', label: 'Any risk' },
    { value: 'high', label: `High and above ${String(high)}` },
  ] as const;
}

/** A high risk at the head the row shows; one assessed at an older head does not count. */
const isRiskyRow = (item: GithubPullItem) =>
  item.risk !== null && item.risk !== undefined && item.risk.current && isHighRisk(item.risk.level);

/** The "Show" filter, with how many pull requests each bucket holds. */
function bucketOptions(counts: ReturnType<typeof countBuckets>) {
  return BUCKET_LABELS.map((option) => ({
    value: option.value,
    label:
      option.value === 'all' ? option.label : `${option.label} ${String(counts[option.value])}`,
  }));
}

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
  const [riskFilter, setRiskFilter] = React.useState<RiskFilter>('all');
  const [query, setQuery] = React.useState('');
  const [version, setVersion] = React.useState(0);
  const [pending, setPending] = React.useState<PendingAction>(null);
  const selection = useSelection();
  const repos = useResource((_signal) => github.listRepos(), [github]);
  const operator = useOperator(health);
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
  // Buckets only describe open work, so a closed or merged view is never narrowed by one.
  const activeBucket = state === 'open' ? bucket : 'all';
  const needle = query.trim().toLowerCase();
  const shown = sortByAttention(items).filter(
    (item) =>
      (activeBucket === 'all' || bucketOf(item) === activeBucket) &&
      (riskFilter === 'all' || isRiskyRow(item)) &&
      matchesQuery(needle, [item.title, item.author, item.repository]),
  );
  const shownKeys = shown.map(subjectKey);
  const notice = inboxNotice({
    list,
    repos,
    noun: 'Pull requests',
    total: items.length,
    shown: shown.length,
  });

  return (
    <PageFrame>
      <h1 className="sr-only">Pull requests</h1>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {state === 'open' ? (
          <Segmented
            label="Show"
            options={bucketOptions(countBuckets(items))}
            value={bucket}
            onChange={setBucket}
          />
        ) : null}
        <Segmented label="State" options={STATES} value={state} onChange={setState} />
        <Segmented
          label="Risk"
          options={riskOptions(items.filter(isRiskyRow).length)}
          value={riskFilter}
          onChange={setRiskFilter}
        />
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
          subjects={shown.filter((item) => selection.has(subjectKey(item))).map(subjectOfPull)}
          onPick={(kind, subjects) => setPending({ kind, subjects })}
          onClear={selection.clear}
        />
      ) : null}
      {notice ??
        (list.status === 'ready' && (
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
                    <RowCheckbox
                      label={`${item.repository}#${String(item.number)}`}
                      rowKey={subjectKey(item)}
                      selection={selection}
                    />
                  )
                : undefined
            }
            listHeader={
              operator ? <SelectAllShown keys={shownKeys} selection={selection} /> : undefined
            }
            footer={<LoadMoreFooter list={list} />}
            renderDetail={(item) => (
              <PullDetail
                item={item}
                now={now()}
                operator={operator}
                onPick={(kind, subject) => setPending({ kind, subjects: [subject] })}
              />
            )}
          />
        ))}
      {pending === null ? null : (
        <GithubActionDialog
          kind={pending.kind}
          subjects={pending.subjects}
          github={github}
          now={now}
          onClose={() => setPending(null)}
          onDone={() => {
            selection.clear();
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
      <RiskLink item={item} />
    </span>
  );
}

/**
 * The row's change risk, linking to why. A risk assessed at an older head says so: the commits
 * since have not been assessed, and their risk is not known.
 */
function RiskLink({ item }: { item: GithubPullItem }): React.ReactElement | null {
  const risk = item.risk;
  if (risk === null || risk === undefined) return null;
  const word = RISK_WORD[risk.level];
  const label = risk.current ? word : `${word} (older head)`;
  return (
    <a
      href={pullRequestRiskPath(item.projectId, item.number)}
      onClick={(event) => event.stopPropagation()}
      aria-label={`${label}, ${String(risk.score)} points: see why`}
      className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      <Badge
        variant={risk.current ? RISK_BADGE[risk.level] : 'outline'}
        className="whitespace-nowrap"
      >
        {label}
      </Badge>
    </a>
  );
}
