import React from 'react';
import { Badge, Input } from '@lupin/ui';
import type { GithubIssueItem } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import { usePagedList } from '../hooks/usePagedList.js';
import { subjectOfIssue } from '../lib/github-actions.js';
import type { GithubClient } from '../lib/github-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { formatRelative } from '../lib/intl.js';
import { Bdi, UserText } from './Bidi.js';
import { GithubActionDialog } from './GithubActionDialog.js';
import { IssueDetail } from './GithubIssueDetail.js';
import { MasterDetail } from './MasterDetail.js';
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
import { RepositoryFilter } from './GithubShared.js';
import { PageFrame, Segmented } from './kit.js';

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
  const [pending, setPending] = React.useState<PendingAction>(null);
  const selection = useSelection();
  const repos = useResource((_signal) => github.listRepos(), [github]);
  const operator = useOperator(health);
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
  const needle = query.trim().toLowerCase();
  const shown = items.filter(
    (issue) =>
      (!untriagedOnly || isUntriaged(issue)) &&
      matchesQuery(needle, [issue.title, issue.author, issue.repository]),
  );
  const shownKeys = shown.map(subjectKey);
  const notice = inboxNotice({
    list,
    repos,
    noun: 'Issues',
    total: items.length,
    shown: shown.length,
  });

  return (
    <PageFrame>
      <h1 className="sr-only">Issues</h1>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {state === 'open' ? (
          <Segmented
            label="Show"
            options={[
              { value: 'all', label: 'All' },
              {
                value: 'untriaged',
                label: `No label or assignee ${String(items.filter(isUntriaged).length)}`,
              },
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
          subjects={shown.filter((issue) => selection.has(subjectKey(issue))).map(subjectOfIssue)}
          onPick={(kind, subjects) => setPending({ kind, subjects })}
          onClear={selection.clear}
        />
      ) : null}
      {notice ??
        (list.status === 'ready' && (
          <MasterDetail
            label="issues"
            title={`${String(shown.length)} ${shown.length === 1 ? 'issue' : 'issues'}`}
            items={shown}
            getKey={subjectKey}
            rowPx={64}
            renderRow={(issue) => <IssueRowSummary issue={issue} now={now()} />}
            renderLead={
              operator
                ? (issue) => (
                    <RowCheckbox
                      label={`${issue.repository}#${String(issue.number)}`}
                      rowKey={subjectKey(issue)}
                      selection={selection}
                    />
                  )
                : undefined
            }
            listHeader={
              operator ? <SelectAllShown keys={shownKeys} selection={selection} /> : undefined
            }
            footer={<LoadMoreFooter list={list} />}
            renderDetail={(issue) => (
              <IssueDetail
                issue={issue}
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

/** What a row says about who owns it: closed, untriaged, or nothing. */
function IssueOwnership({ issue }: { issue: GithubIssueItem }): React.ReactElement | null {
  if (issue.state === 'closed') {
    return (
      <Badge variant="outline" className="shrink-0">
        Closed
      </Badge>
    );
  }
  if (!isUntriaged(issue)) return null;
  return (
    <Badge variant="warning" className="shrink-0 whitespace-nowrap">
      Untriaged
    </Badge>
  );
}

/** The one-line summary a row carries: the title, who and when, and whether anyone owns it. */
function IssueRowSummary({
  issue,
  now,
}: {
  issue: GithubIssueItem;
  now: Date;
}): React.ReactElement {
  return (
    <span data-testid="issue-row" className="flex h-full min-w-0 items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <UserText className="truncate font-medium">{issue.title}</UserText>
        <span className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
          <Bdi className="truncate font-mono">
            {issue.repository}#{String(issue.number)}
          </Bdi>
          {issue.author === null ? null : <Bdi className="truncate">{issue.author}</Bdi>}
          <span className="whitespace-nowrap">{formatRelative(issue.lastActivityAt, now)}</span>
        </span>
      </span>
      <IssueOwnership issue={issue} />
    </span>
  );
}
