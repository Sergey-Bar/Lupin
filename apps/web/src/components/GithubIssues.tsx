import React from 'react';
import {
  Badge,
  Button,
  ExternalLink,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lupin/ui';
import type { GithubIssueItem } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import { usePagedList } from '../hooks/usePagedList.js';
import { subjectOfIssue, type ActionKind, type Subject } from '../lib/github-actions.js';
import type { GithubClient } from '../lib/github-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { canOperate } from '../lib/roles.js';
import { formatRelative } from '../lib/intl.js';
import { Bdi, UserText } from './Bidi.js';
import { GithubActionDialog } from './GithubActionDialog.js';
import { BulkBar, RowActions, subjectKey } from './GithubActionControls.js';
import { RepositoryFilter } from './GithubShared.js';
import { PageFrame, PageHeader, Panel, Quiet, Segmented } from './kit.js';

/**
 * Open issues across every repository, with the ones nobody has labelled or assigned counted
 * first: those are the ones a triage pass exists to find. Titles, labels and assignees are what
 * people wrote, so they take their own direction (`UserText`); a repository and a number are
 * identifiers and stay left to right.
 */
type StateFilter = 'open' | 'closed' | 'all';

const STATES = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
] as const;

const isUntriaged = (issue: GithubIssueItem) =>
  issue.state === 'open' && issue.labels.length === 0 && issue.assignees.length === 0;

export function IssuesPage({
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
  const [untriagedOnly, setUntriagedOnly] = React.useState(false);
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
      github.listIssues({
        state,
        projectId: projectId === '' ? undefined : projectId,
        limit: 50,
        cursor,
      }),
    [github, state, projectId, version],
  );

  const items = list.status === 'ready' ? list.items : [];
  const untriaged = items.filter(isUntriaged).length;
  const needle = query.trim().toLowerCase();
  const shown = items.filter((issue) => {
    if (untriagedOnly && !isUntriaged(issue)) return false;
    if (needle === '') return true;
    return [issue.title, issue.author ?? '', issue.repository].some((text) =>
      text.toLowerCase().includes(needle),
    );
  });

  return (
    <PageFrame>
      <PageHeader title="Issues" />
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {state === 'open' ? (
          <Segmented
            label="Show"
            options={[
              { value: 'all', label: 'All' },
              { value: 'untriaged', label: `No label or assignee ${String(untriaged)}` },
            ]}
            value={untriagedOnly ? 'untriaged' : 'all'}
            onChange={(value) => setUntriagedOnly(value === 'untriaged')}
          />
        ) : null}
        <Segmented
          label="State"
          options={STATES}
          value={state}
          onChange={(value) => {
            setState(value);
            setUntriagedOnly(false);
          }}
        />
        <div className="flex flex-wrap items-center gap-3 sm:ms-auto">
          <RepositoryFilter
            id="issues-repository"
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
          subjects={shown.filter((issue) => selected.has(subjectKey(issue))).map(subjectOfIssue)}
          onPick={(kind, subjects) => setPending({ kind, subjects })}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      <Panel
        title={`${String(shown.length)} ${shown.length === 1 ? 'issue' : 'issues'}`}
        className="flex-1"
      >
        {list.status === 'loading' ? (
          <Quiet role="status">Loading…</Quiet>
        ) : list.status === 'error' ? (
          <Quiet role="alert">Could not load this: {list.message}</Quiet>
        ) : shown.length === 0 ? (
          <Quiet>
            {items.length === 0 &&
            repos.status === 'ready' &&
            repos.value.items.every((r) => !r.syncEnabled)
              ? 'Issues appear once a repository is being read. Turn on the sync for a project under Repositories.'
              : 'No issues match.'}
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
                          shown.length > 0 &&
                          shown.every((issue) => selected.has(subjectKey(issue)))
                        }
                        onChange={(event) =>
                          setSelected(
                            event.target.checked ? new Set(shown.map(subjectKey)) : new Set(),
                          )
                        }
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>Issue</TableHead>
                  <TableHead>Assignees</TableHead>
                  <TableHead className="text-end">Comments</TableHead>
                  <TableHead>Updated</TableHead>
                  {operator ? (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    now={now()}
                    operator={operator}
                    selected={selected.has(subjectKey(issue))}
                    onToggle={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        const key = subjectKey(issue);
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

function IssueRow({
  issue,
  now,
  operator,
  selected,
  onToggle,
  onPick,
}: {
  issue: GithubIssueItem;
  now: Date;
  operator: boolean;
  selected: boolean;
  onToggle: () => void;
  onPick: (kind: ActionKind, subject: Subject) => void;
}): React.ReactElement {
  return (
    <TableRow data-testid="issue-row">
      {operator ? (
        <TableCell>
          <input
            type="checkbox"
            aria-label={`Select ${issue.repository}#${String(issue.number)}`}
            checked={selected}
            onChange={onToggle}
          />
        </TableCell>
      ) : null}
      <TableCell className="max-w-[28rem]">
        <div className="flex min-w-0 flex-col gap-1">
          {issue.htmlUrl === null ? (
            <UserText className="truncate font-medium">{issue.title}</UserText>
          ) : (
            <a
              href={issue.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${issue.repository}#${String(issue.number)} on GitHub`}
              className="inline-flex min-w-0 items-center gap-1 font-medium underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <UserText className="truncate">{issue.title}</UserText>
              <ExternalLink size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
            </a>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <Bdi className="font-mono">
              {issue.repository}#{String(issue.number)}
            </Bdi>
            {issue.state === 'closed' ? <Badge variant="outline">Closed</Badge> : null}
            {issue.labels.map((label) => (
              <Badge key={label} variant="secondary">
                <UserText>{label}</UserText>
              </Badge>
            ))}
          </div>
        </div>
      </TableCell>
      <TableCell>
        {issue.assignees.length === 0 ? (
          <span className="text-fg-muted">Unassigned</span>
        ) : (
          <span className="flex flex-wrap gap-x-2">
            {issue.assignees.map((login) => (
              <Bdi key={login}>{login}</Bdi>
            ))}
          </span>
        )}
      </TableCell>
      <TableCell className="text-end tabular-nums">{issue.commentCount}</TableCell>
      <TableCell className="whitespace-nowrap text-fg-muted">
        {formatRelative(issue.lastActivityAt, now)}
      </TableCell>
      {operator ? (
        <TableCell>
          <RowActions subject={subjectOfIssue(issue)} onPick={onPick} />
        </TableCell>
      ) : null}
    </TableRow>
  );
}
