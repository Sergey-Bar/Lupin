import React from 'react';
import {
  Badge,
  Button,
  CircleAlert,
  CircleCheck,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Timer,
} from '@lupin/ui';
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
import { BulkBar, RowActions } from './GithubActionControls.js';
import { StatusLine } from './StatusLine.js';
import { useToast } from './Toasts.js';

/**
 * Every repository Lupin can read: its grade, what is open, and whether it is being synced.
 * A repository that is not being synced is shown as "Not graded", never as a good grade: the
 * analyzer only grades what it has read.
 */
const BAD = new Set(['critical', 'high']);
const attention = (repo: GithubRepoItem) =>
  repo.health.findings.some((finding) => BAD.has(finding.severity));

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
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = React.useState<{
    kind: ActionKind;
    subjects: readonly Subject[];
  } | null>(null);
  const repos = useResource((_signal) => github.listRepos(), [github, version]);
  const who = useResource((_signal) => health.whoami(), [health]);
  const operator = who.status === 'ready' && canOperate(who.value);
  const items = repos.status === 'ready' ? repos.value.items : [];
  const flagged = items.filter(attention).length;

  return (
    <PageFrame>
      <PageHeader
        title="Repositories"
        subtitle="Health and open work for every repository Lupin can read."
      />
      <StatusLine
        data-testid="repos-status"
        value={String(flagged)}
        sentence={
          flagged === 1
            ? 'repository has a critical or high finding'
            : 'repositories have a critical or high finding'
        }
        tone={flagged === 0 ? 'good' : 'bad'}
      />
      {operator ? (
        <BulkBar
          subjects={items.filter((repo) => selected.has(repo.projectId)).map(subjectOfRepo)}
          onPick={(kind, subjects) => setPending({ kind, subjects })}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      <Panel title="Repositories" className="flex-1">
        {repos.status === 'loading' ? (
          <Quiet role="status">Loading…</Quiet>
        ) : repos.status === 'error' ? (
          <Quiet role="alert">Could not load this: {repos.message}</Quiet>
        ) : items.length === 0 ? (
          <Quiet>No repositories yet. Add a project with a GitHub repository URL.</Quiet>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {operator ? (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all repositories"
                        checked={
                          items.length > 0 && items.every((repo) => selected.has(repo.projectId))
                        }
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? new Set(items.map((repo) => repo.projectId))
                              : new Set(),
                          )
                        }
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>Repository</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-end">Pull requests</TableHead>
                  <TableHead className="text-end">Issues</TableHead>
                  <TableHead>Sync</TableHead>
                  <TableHead>
                    <span className="sr-only">Details</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((repo) => (
                  <TableRow key={repo.projectId} data-testid="repo-row">
                    {operator ? (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${repo.name}`}
                          checked={selected.has(repo.projectId)}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (next.has(repo.projectId)) next.delete(repo.projectId);
                              else next.add(repo.projectId);
                              return next;
                            })
                          }
                        />
                      </TableCell>
                    ) : null}{' '}
                    <TableCell>
                      <div className="flex min-w-0 flex-col">
                        <UserText className="truncate font-medium">{repo.name}</UserText>
                        {repo.repository === null ? null : (
                          <Bdi className="font-mono text-xs text-fg-muted">{repo.repository}</Bdi>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <GradeBadge repo={repo} />
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatNumber(repo.openPullRequests)}
                      {repo.stalePullRequests > 0 ? (
                        <span className="block text-xs text-fg-muted">
                          {repo.stalePullRequests} stale
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatNumber(repo.openIssues)}
                    </TableCell>
                    <TableCell>
                      <SyncCell
                        repo={repo}
                        now={now()}
                        operator={operator}
                        delivery={delivery}
                        onDone={() => setVersion((current) => current + 1)}
                      />
                    </TableCell>
                    {operator ? (
                      <TableCell>
                        <RowActions
                          subject={subjectOfRepo(repo)}
                          onPick={(kind, subject) => setPending({ kind, subjects: [subject] })}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <a
                        href={repoDetailPath(repo.projectId)}
                        aria-label={`Details for ${repo.name}`}
                        className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                      >
                        Details
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
        <Quiet role="alert">Could not load this: {repo.message}</Quiet>
      </PageFrame>
    );
  }
  const item = repo.value;
  const budget = item.state?.rateLimit ?? null;
  return (
    <PageFrame>
      <PageHeader
        title={item.name}
        subtitle={
          item.repository === null ? undefined : <Bdi className="font-mono">{item.repository}</Bdi>
        }
        actions={
          <>
            {operator ? (
              <Button variant="outline" onClick={() => setPending('createRelease')}>
                Create release
              </Button>
            ) : null}
            <a
              href={`/dashboard/repos`}
              className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              All repositories
            </a>
            <a
              href={`/dashboard/prs?project=${encodeURIComponent(item.projectId)}`}
              className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Pull requests
            </a>
            <a
              href={`/dashboard/issues?project=${encodeURIComponent(item.projectId)}`}
              className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Issues
            </a>
          </>
        }
      />
      <StatusLine
        data-testid="repo-score"
        value={item.health.score === null ? '—' : String(item.health.score)}
        sentence={
          item.health.grade === null
            ? 'not graded: this repository has not been read yet'
            : `health score, grade ${item.health.grade}`
        }
        tone={
          item.health.score === null || item.health.score < 60
            ? 'bad'
            : item.health.score < 90
              ? 'caution'
              : 'good'
        }
      />
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3">
        <Panel title="Findings" className="lg:col-span-2">
          {item.health.findings.length === 0 ? (
            <Quiet>Nothing wrong was found.</Quiet>
          ) : (
            <ul className="m-0 flex min-h-0 list-none flex-col gap-3 overflow-auto p-0">
              {item.health.findings.map((finding) => {
                const severity = SEVERITY[finding.severity];
                return (
                  <li key={finding.id} data-testid="finding" className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={severity.variant}>{severity.label}</Badge>
                      <span className="font-medium">{finding.title}</span>
                    </div>
                    <p className="m-0 text-sm text-fg-muted">{finding.evidence}</p>
                    {operator && finding.fix === 'protect-branch' ? (
                      <div>
                        <Button variant="outline" onClick={() => setPending('protectBranch')}>
                          Protect the default branch
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Open work">
          <dl className="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-2 text-sm">
            <dt className="text-fg-muted">Pull requests</dt>
            <dd className="m-0 text-end tabular-nums">{formatNumber(item.openPullRequests)}</dd>
            <dt className="text-fg-muted">Stale pull requests</dt>
            <dd className="m-0 text-end tabular-nums">{formatNumber(item.stalePullRequests)}</dd>
            <dt className="text-fg-muted">Issues</dt>
            <dd className="m-0 text-end tabular-nums">{formatNumber(item.openIssues)}</dd>
            <dt className="text-fg-muted">Request budget</dt>
            <dd className="m-0 text-end">
              {budget === null
                ? 'Not reported yet'
                : `${formatNumber(budget.remaining)} of ${formatNumber(budget.limit)} left, resets ${formatRelative(budget.resetAt, now())}`}
            </dd>
            <dt className="text-fg-muted">Last sync</dt>
            <dd className="m-0 text-end">
              {item.lastSyncedAt === null ? 'Never' : formatRelative(item.lastSyncedAt, now())}
            </dd>
          </dl>
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
