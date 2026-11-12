import React from 'react';
import { isNothingYet } from '../lib/nothing-yet.js';
import { Badge, Button, cn, CircleAlert, CircleCheck, Timer } from '@lupin/ui';
import type { GithubFinding, GithubRepoItem } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { DeliveryClient } from '../lib/delivery-client.js';
import { subjectOfRepo, type ActionKind, type Subject } from '../lib/github-actions.js';
import type { GithubClient } from '../lib/github-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { formatNumber, formatRelative } from '../lib/intl.js';
import { canOperate, failureText } from '../lib/roles.js';
import { repoDetailPath } from '../route-manifest.js';
import { Bdi, UserText } from './Bidi.js';
import { PageFrame, PageHeader, Panel, Quiet } from './kit.js';
import { GithubActionDialog } from './GithubActionDialog.js';
import { MasterDetail } from './MasterDetail.js';
import { BulkBar, RowActions } from './GithubActionControls.js';
import {
  RowCheckbox,
  SelectAllShown,
  inboxNotice,
  useOperator,
  useSelection,
  type PendingAction,
} from './GithubInboxParts.js';
import { useToast } from './Toasts.js';

/**
 * Every repository Lupin can read: its grade, what is open, and whether it is being synced.
 * A repository that is not being synced is shown as "Not graded", never as a good grade: the
 * analyzer only grades what it has read.
 */
const BAD = new Set(['critical', 'high']);
const attention = (repo: GithubRepoItem) =>
  repo.health.findings.some((finding) => BAD.has(finding.severity));

/** Serious findings first, then the lowest score; a repository nobody has read yet goes last. */
function worstFirst(repos: readonly GithubRepoItem[]): GithubRepoItem[] {
  return [...repos].sort(
    (a, b) =>
      Number(attention(b)) - Number(attention(a)) ||
      (a.health.score ?? Infinity) - (b.health.score ?? Infinity),
  );
}

const GRADE_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = {
  A: 'success',
  B: 'success',
  C: 'warning',
  D: 'danger',
  F: 'danger',
};

function GradeBadge({ repo }: { repo: GithubRepoItem }): React.ReactElement {
  if (repo.health.grade === null || repo.health.score === null) {
    return <span className="text-fg-muted">Not graded</span>;
  }
  const bad = repo.health.grade === 'D' || repo.health.grade === 'F';
  const Icon = bad ? CircleAlert : repo.health.grade === 'C' ? Timer : CircleCheck;
  return (
    <Badge
      variant={GRADE_VARIANT[repo.health.grade] ?? 'warning'}
      className="gap-1 whitespace-nowrap"
    >
      <Icon size={12} aria-hidden="true" />
      Grade {repo.health.grade}
      <span className="tabular-nums">· {repo.health.score}</span>
    </Badge>
  );
}

/** Turns the GitHub sync on for a project, then asks for a first read. Operators only. */
function EnableSync({
  repo,
  delivery,
  onDone,
}: {
  repo: GithubRepoItem;
  delivery: DeliveryClient;
  onDone: () => void;
}): React.ReactElement {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const enable = () => {
    setBusy(true);
    delivery
      .setSource(repo.projectId, {
        enabled: true,
        cadence: 'daily',
        productionEnvironments: ['production'],
        deployWorkflows: [],
      })
      .then(() => delivery.sync(repo.projectId))
      .then(() => {
        toast({
          tone: 'success',
          title: `Sync is on for ${repo.name}`,
          description: 'The first read can take a minute.',
        });
        onDone();
      })
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Could not turn on sync',
          description: failureText(error, 'The sync could not start'),
        }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={enable}
      aria-label={`Turn on sync for ${repo.name}`}
    >
      {busy ? 'Turning on…' : 'Turn on sync'}
    </Button>
  );
}

function SyncCell({
  repo,
  now,
  operator,
  delivery,
  onDone,
}: {
  repo: GithubRepoItem;
  now: Date;
  operator: boolean;
  delivery: DeliveryClient;
  onDone: () => void;
}): React.ReactElement {
  if (!repo.syncEnabled) {
    return operator ? (
      <EnableSync repo={repo} delivery={delivery} onDone={onDone} />
    ) : (
      <span className="text-fg-muted">Not syncing</span>
    );
  }
  return (
    <div className="flex flex-col text-xs">
      <span className="text-fg">
        {repo.lastStatus === 'failed' ? 'Last sync failed' : 'Syncing'}
      </span>
      <span className="text-fg-muted">
        {repo.lastSyncedAt === null
          ? 'Never synced'
          : `Synced ${formatRelative(repo.lastSyncedAt, now)}`}
      </span>
    </div>
  );
}

/** The one-line summary a row carries: the name and path, the grade, and what hurts most. */
function RepoRowSummary({ repo }: { repo: GithubRepoItem }): React.ReactElement {
  const worst = repo.health.findings[0];
  return (
    <span data-testid="repo-row" className="flex h-full min-w-0 items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <UserText className="truncate font-medium">{repo.name}</UserText>
        <span className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
          {repo.repository === null ? null : (
            <Bdi className="truncate font-mono">{repo.repository}</Bdi>
          )}
          {worst === undefined ? null : <span className="truncate">{worst.title}</span>}
        </span>
      </span>
      <GradeBadge repo={repo} />
    </span>
  );
}

/** Everything about the selected repository, so a row never has to be opened to be understood. */
function RepoPane({
  repo,
  now,
  operator,
  delivery,
  onSynced,
  onPick,
}: {
  repo: GithubRepoItem;
  now: Date;
  operator: boolean;
  delivery: DeliveryClient;
  onSynced: () => void;
  onPick: (kind: ActionKind, subject: Subject) => void;
}): React.ReactElement {
  const subject = subjectOfRepo(repo);
  return (
    <article data-testid="repo-detail" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-semibold leading-snug">
            <UserText>{repo.name}</UserText>
          </h2>
          {repo.repository === null ? null : (
            <Bdi className="font-mono text-xs text-fg-muted">{repo.repository}</Bdi>
          )}
        </div>
        <GradeBadge repo={repo} />
      </header>
      <SyncCell repo={repo} now={now} operator={operator} delivery={delivery} onDone={onSynced} />
      <section aria-label="Findings" className="flex min-h-0 flex-col gap-3">
        <FindingsList item={repo} operator={false} compact />
      </section>
      <OpenWorkList item={repo} now={now} showSync={false} />
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
        {operator ? <RowActions subject={subject} onPick={onPick} /> : null}
        <a
          href={repoDetailPath(repo.projectId)}
          aria-label={`Details for ${repo.name}`}
          className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          Details
        </a>
      </div>
    </article>
  );
}

export function ReposPage({
  github,
  delivery,
  health,
  now = () => new Date(),
}: {
  github: GithubClient;
  delivery: DeliveryClient;
  health: HealthClient;
  now?: () => Date;
}): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const [pending, setPending] = React.useState<PendingAction>(null);
  const selection = useSelection();
  const repos = useResource((_signal) => github.listRepos(), [github, version]);
  const operator = useOperator(health);
  const items = repos.status === 'ready' ? worstFirst(repos.value.items) : [];
  const flagged = items.filter(attention).length;
  const notice = inboxNotice({
    list: repos,
    noun: 'Repositories',
    total: items.length,
    shown: items.length,
    empty: 'No repositories yet. Add a project with a GitHub repository URL.',
  });

  return (
    <PageFrame>
      <h1 className="sr-only">Repositories</h1>
      {operator ? (
        <BulkBar
          subjects={items.filter((repo) => selection.has(repo.projectId)).map(subjectOfRepo)}
          onPick={(kind, subjects) => setPending({ kind, subjects })}
          onClear={selection.clear}
        />
      ) : null}
      {notice ??
        (repos.status === 'ready' && (
          <MasterDetail
            label="repositories"
            title={`${String(items.length)} ${items.length === 1 ? 'repository' : 'repositories'}`}
            action={<AttentionBadge flagged={flagged} />}
            items={items}
            getKey={(repo) => repo.projectId}
            rowPx={64}
            renderRow={(repo) => <RepoRowSummary repo={repo} />}
            renderLead={
              operator
                ? (repo) => (
                    <RowCheckbox label={repo.name} rowKey={repo.projectId} selection={selection} />
                  )
                : undefined
            }
            listHeader={
              operator ? (
                <SelectAllShown
                  label="Select all repositories"
                  keys={items.map((repo) => repo.projectId)}
                  selection={selection}
                />
              ) : undefined
            }
            renderDetail={(repo) => (
              <RepoPane
                repo={repo}
                now={now()}
                operator={operator}
                delivery={delivery}
                onSynced={() => setVersion((current) => current + 1)}
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

/** How many repositories need a look, or nothing when none do. */
function AttentionBadge({ flagged }: { flagged: number }): React.ReactElement | null {
  if (flagged === 0) return null;
  return (
    <Badge variant="danger">
      {String(flagged)} {flagged === 1 ? 'needs' : 'need'} attention
    </Badge>
  );
}
const SEVERITY: Record<
  GithubFinding['severity'],
  { label: string; variant: 'danger' | 'warning' | 'outline' | 'secondary' }
> = {
  critical: { label: 'Critical', variant: 'danger' },
  high: { label: 'High', variant: 'danger' },
  medium: { label: 'Medium', variant: 'warning' },
  low: { label: 'Low', variant: 'secondary' },
  info: { label: 'Note', variant: 'outline' },
};

/** The findings that count pull requests or issues, and the list that shows exactly those. */
const FINDING_LIST: Record<string, { path: 'prs' | 'issues'; label: string } | undefined> = {
  'failing-pull-requests': { path: 'prs', label: 'See pull requests' },
  'conflicted-pull-requests': { path: 'prs', label: 'See pull requests' },
  'unreviewed-pull-requests': { path: 'prs', label: 'See pull requests' },
  'stale-pull-requests': { path: 'prs', label: 'See pull requests' },
  'untriaged-issues': { path: 'issues', label: 'See issues' },
};

/** Every finding worst first, each with the evidence behind it and, when there is one, the fix. */
function FindingsList({
  item,
  operator,
  onFix,
  compact = false,
}: {
  item: GithubRepoItem;
  operator: boolean;
  /** Present: a finding that has a fix offers it, to an operator. */
  onFix?: (() => void) | undefined;
  /** Tighter, for a pane that has to fit beside a list without scrolling. */
  compact?: boolean;
}): React.ReactElement {
  return (
    <>
      {item.health.findings.length === 0 ? (
        <Quiet>Nothing wrong was found.</Quiet>
      ) : (
        <div
          role="list"
          className={cn('m-0 flex min-h-0 flex-col overflow-auto p-0', compact ? 'gap-2' : 'gap-3')}
        >
          {item.health.findings.map((finding) => {
            const severity = SEVERITY[finding.severity];
            return (
              <div
                key={finding.id}
                role="listitem"
                data-testid="finding"
                className={cn('flex flex-col', compact ? 'gap-0.5' : 'gap-1')}
              >
                <div className="flex items-center gap-2">
                  <Badge variant={severity.variant}>{severity.label}</Badge>
                  <span className="font-medium">{finding.title}</span>
                </div>
                <p className={cn('m-0 text-fg-muted', compact ? 'text-xs' : 'text-sm')}>
                  {finding.evidence}
                </p>
                {FINDING_LIST[finding.id] === undefined ? null : (
                  <div>
                    <a
                      href={`/dashboard/${FINDING_LIST[finding.id]?.path ?? 'prs'}?project=${encodeURIComponent(item.projectId)}`}
                      className="text-sm underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      {FINDING_LIST[finding.id]?.label}
                    </a>
                  </div>
                )}
                {operator && onFix !== undefined && finding.fix === 'protect-branch' ? (
                  <div>
                    <Button variant="outline" onClick={onFix}>
                      Protect the default branch
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** What is open, how stale, and what is left of the request budget, with links to the lists. */
function OpenWorkList({
  item,
  now,
  showSync = true,
}: {
  item: GithubRepoItem;
  now: Date;
  /** The pane already shows the sync above it. */
  showSync?: boolean;
}): React.ReactElement {
  const budget = item.state?.rateLimit ?? null;
  return (
    <dl className="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-2 text-sm">
      <dt className="text-fg-muted">
        <a
          href={`/dashboard/prs?project=${encodeURIComponent(item.projectId)}`}
          className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          Pull requests
        </a>
      </dt>
      <dd className="m-0 text-end tabular-nums">{formatNumber(item.openPullRequests)}</dd>
      <dt className="text-fg-muted">Stale pull requests</dt>
      <dd className="m-0 text-end tabular-nums">{formatNumber(item.stalePullRequests)}</dd>
      <dt className="text-fg-muted">
        <a
          href={`/dashboard/issues?project=${encodeURIComponent(item.projectId)}`}
          className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          Issues
        </a>
      </dt>
      <dd className="m-0 text-end tabular-nums">{formatNumber(item.openIssues)}</dd>
      <dt className="text-fg-muted">Request budget</dt>
      <dd className="m-0 text-end">
        {budget === null
          ? 'Not reported yet'
          : `${formatNumber(budget.remaining)} of ${formatNumber(budget.limit)} left, resets ${formatRelative(budget.resetAt, now)}`}
      </dd>
      {showSync ? (
        <>
          <dt className="text-fg-muted">Last sync</dt>
          <dd className="m-0 text-end">
            {item.lastSyncedAt === null ? 'Never' : formatRelative(item.lastSyncedAt, now)}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/** One repository: its grade, why, and what is open. */
export function RepoDetailPage({
  projectId,
  github,
  health,
  now = () => new Date(),
}: {
  projectId: string;
  github: GithubClient;
  /** Present: an operator is offered the fixes and a release. Absent: read-only. */
  health?: HealthClient | undefined;
  now?: () => Date;
}): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const [pending, setPending] = React.useState<ActionKind | null>(null);
  const repo = useResource((_signal) => github.getRepo(projectId), [github, projectId, version]);
  const who = useResource(
    (_signal) => (health === undefined ? Promise.resolve(null) : health.whoami()),
    [health],
  );
  const operator = who.status === 'ready' && who.value !== null && canOperate(who.value);
  if (repo.status === 'loading') {
    return (
      <PageFrame>
        <Quiet role="status">Loading…</Quiet>
      </PageFrame>
    );
  }
  if (repo.status === 'error') {
    return (
      <PageFrame>
        <Quiet role={isNothingYet(repo.message) ? undefined : 'alert'}>
          {isNothingYet(repo.message)
            ? 'GitHub is not connected yet. Connect it in Settings to see repositories here.'
            : `Could not load this: ${repo.message}`}
        </Quiet>
      </PageFrame>
    );
  }
  const item = repo.value;
  return (
    <PageFrame>
      <PageHeader
        title={item.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {item.repository === null ? null : <Bdi className="font-mono">{item.repository}</Bdi>}
            <a
              href="/dashboard/repos"
              className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              All repositories
            </a>
          </span>
        }
        actions={
          <>
            <span
              data-testid="repo-score"
              className="flex items-baseline gap-2 text-sm text-fg-muted"
            >
              {item.health.score === null || item.health.grade === null ? (
                'Not graded: this repository has not been read yet'
              ) : (
                <>
                  <span
                    className={cn(
                      'text-4xl font-semibold tabular-nums tracking-tight',
                      item.health.score < 60
                        ? 'text-danger'
                        : item.health.score < 90
                          ? 'text-warning'
                          : 'text-success',
                    )}
                  >
                    {item.health.score}
                  </span>
                  Grade {item.health.grade}
                </>
              )}
            </span>
            {operator ? (
              <Button variant="outline" onClick={() => setPending('createRelease')}>
                Create release
              </Button>
            ) : null}
          </>
        }
      />{' '}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3">
        <Panel title="Findings" className="lg:col-span-2">
          <FindingsList item={item} operator={operator} onFix={() => setPending('protectBranch')} />
        </Panel>
        <Panel title="Open work">
          <OpenWorkList item={item} now={now()} />
        </Panel>
      </div>
      {pending === null ? null : (
        <GithubActionDialog
          kind={pending}
          subjects={[subjectOfRepo(item)]}
          github={github}
          now={now}
          onClose={() => setPending(null)}
          onDone={() => setVersion((current) => current + 1)}
        />
      )}
    </PageFrame>
  );
}
