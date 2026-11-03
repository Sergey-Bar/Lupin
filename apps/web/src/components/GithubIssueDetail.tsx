import React from 'react';
import { Badge, ExternalLink } from '@lupin/ui';
import type { GithubIssueItem } from '@lupin/shared-contracts';
import { subjectOfIssue, type ActionKind, type Subject } from '../lib/github-actions.js';
import { formatDateTime, formatNumber, formatRelative } from '../lib/intl.js';
import { Bdi, UserText } from './Bidi.js';
import { RowActions } from './GithubActionControls.js';

/** One sentence on who owns an issue: nobody, nobody any more, or somebody. */
function ownershipSentence(issue: GithubIssueItem, untriaged: boolean): string {
  if (untriaged) return 'Nobody owns this yet: it has no label and no assignee.';
  if (issue.state === 'closed') return 'This issue is closed.';
  if (issue.assignees.length === 0) return 'Labelled, but nobody is assigned to it.';
  return 'Labelled and assigned.';
}

/** Badges for a list of names, or a quiet word when there are none. */
function BadgeList({
  names,
  empty,
  variant,
  render,
}: {
  names: readonly string[];
  empty: string;
  variant: 'outline' | 'secondary';
  render: (name: string) => React.ReactNode;
}): React.ReactElement {
  if (names.length === 0) return <span className="text-fg-muted">{empty}</span>;
  return (
    <>
      {names.map((name) => (
        <Badge key={name} variant={variant}>
          {render(name)}
        </Badge>
      ))}
    </>
  );
}

/**
 * Everything the dashboard knows about one issue: whether anyone owns it, who is involved, how
 * much has been said, and when. No `<li>` in here: `j` / `k` walk every `li` on the page.
 */
export function IssueDetail({
  issue,
  now,
  operator,
  onPick,
}: {
  issue: GithubIssueItem;
  now: Date;
  operator: boolean;
  onPick: (kind: ActionKind, subject: Subject) => void;
}): React.ReactElement {
  const untriaged =
    issue.state === 'open' && issue.labels.length === 0 && issue.assignees.length === 0;
  return (
    <article data-testid="issue-detail" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <Bdi className="font-mono">
            {issue.repository}#{String(issue.number)}
          </Bdi>
          <Badge variant={issue.state === 'open' ? 'success' : 'outline'}>
            {issue.state === 'open' ? 'Open' : 'Closed'}
          </Badge>
          {untriaged ? <Badge variant="warning">Untriaged</Badge> : null}
        </div>
        <h2 className="m-0 text-lg font-semibold leading-snug text-balance">
          {issue.htmlUrl === null ? (
            <UserText>{issue.title}</UserText>
          ) : (
            <a
              href={issue.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${issue.repository}#${String(issue.number)} on GitHub`}
              className="inline-flex items-start gap-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <UserText>{issue.title}</UserText>
              <ExternalLink
                size={14}
                aria-hidden="true"
                className="mt-1.5 shrink-0 text-fg-muted"
              />
            </a>
          )}
        </h2>
        <p className="m-0 text-sm leading-relaxed text-fg-muted">
          {ownershipSentence(issue, untriaged)}
        </p>
      </header>
      {operator ? (
        <div className="flex flex-wrap items-center gap-2">
          <RowActions subject={subjectOfIssue(issue)} onPick={onPick} />
        </div>
      ) : null}
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        <dt className="text-fg-muted">Reporter</dt>
        <dd className="m-0">{issue.author === null ? '—' : <Bdi>{issue.author}</Bdi>}</dd>
        <dt className="text-fg-muted">Assignees</dt>
        <dd className="m-0 flex flex-wrap gap-1">
          <BadgeList
            names={issue.assignees}
            empty="Unassigned"
            variant="outline"
            render={(login) => <Bdi>{login}</Bdi>}
          />
        </dd>
        <dt className="text-fg-muted">Labels</dt>
        <dd className="m-0 flex flex-wrap gap-1">
          <BadgeList
            names={issue.labels}
            empty="None"
            variant="secondary"
            render={(label) => <UserText>{label}</UserText>}
          />
        </dd>
        <dt className="text-fg-muted">Comments</dt>
        <dd className="m-0 tabular-nums">{formatNumber(issue.commentCount)}</dd>
        <dt className="text-fg-muted">Opened</dt>
        <dd className="m-0">
          <time dateTime={issue.openedAt} title={formatDateTime(new Date(issue.openedAt))}>
            {formatRelative(issue.openedAt, now)}
          </time>
          <span className="text-fg-muted">
            {' '}
            · active {formatRelative(issue.lastActivityAt, now)}
          </span>
        </dd>
      </dl>
    </article>
  );
}
