import React from 'react';
import {
  ArrowRight,
  Badge,
  Button,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  GitBranch,
  Timer,
} from '@lupin/ui';
import type { GithubPullItem } from '@lupin/shared-contracts';
import { subjectOfPull, type ActionKind, type Subject } from '../lib/github-actions.js';
import { adviceOf, gatesOf, primaryActionOf, statusOf, type Gate } from '../lib/github-view.js';
import { formatDateTime, formatNumber, formatRelative } from '../lib/intl.js';
import { Bdi, UserText } from './Bidi.js';
import { ACTION_LABEL } from './GithubActionDialog.js';
import { RowActions } from './GithubActionControls.js';

const GATE_ICON = { success: CircleCheck, danger: CircleAlert, warning: Timer, outline: null };
const GATE_TEXT = {
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
  outline: 'text-fg-muted',
} as const;

function GateRow({ gate }: { gate: Gate }): React.ReactElement {
  const Icon = GATE_ICON[gate.tone];
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 text-xs text-fg-muted">
        <span className={GATE_TEXT[gate.tone]}>
          {Icon === null ? (
            <span aria-hidden="true" className="inline-block w-3.5 text-center">
              –
            </span>
          ) : (
            <Icon size={14} aria-hidden="true" />
          )}
        </span>
        {gate.name}
      </span>
      <span className="font-medium leading-snug">{gate.label}</span>
    </div>
  );
}

/** Additions and deletions as one bar, so the size of a change is seen before it is read. */
function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const added = total === 0 ? 0 : Math.round((additions / total) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div
        aria-hidden="true"
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-muted"
      >
        <div className="bg-success" style={{ width: `${String(added)}%` }} />
        <div className="bg-danger" style={{ width: `${String(total === 0 ? 0 : 100 - added)}%` }} />
      </div>
      <span className="text-sm tabular-nums">
        <span className="text-success">+{formatNumber(additions)}</span>{' '}
        <span className="text-danger">−{formatNumber(deletions)}</span>
      </span>
    </div>
  );
}

/**
 * Everything the dashboard knows about one pull request, in the order a reader decides: what it
 * is, whether it can merge and what stands in the way, where it comes from, who is involved,
 * how big it is, and what can be done. No `<li>` in here: `j` / `k` walk every `li` on the page.
 */
export function PullDetail({
  item,
  now,
  operator,
  onPick,
}: {
  item: GithubPullItem;
  now: Date;
  operator: boolean;
  onPick: (kind: ActionKind, subject: Subject) => void;
}): React.ReactElement {
  const subject = subjectOfPull(item);
  const status = statusOf(item);
  const primary = primaryActionOf(item);
  const gates = gatesOf(item);
  return (
    <article data-testid="pull-detail" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <Bdi className="font-mono">
            {item.repository}#{String(item.number)}
          </Bdi>
          <Badge variant={status.tone}>{status.headline}</Badge>
        </div>
        <h2 className="m-0 text-lg font-semibold leading-snug text-balance">
          {item.htmlUrl === null ? (
            <UserText>{item.title}</UserText>
          ) : (
            <a
              href={item.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${item.repository}#${String(item.number)} on GitHub`}
              className="inline-flex items-start gap-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <UserText>{item.title}</UserText>
              <ExternalLink
                size={14}
                aria-hidden="true"
                className="mt-1.5 shrink-0 text-fg-muted"
              />
            </a>
          )}
        </h2>
        <p className="m-0 text-sm leading-relaxed text-fg-muted">{adviceOf(item)}</p>
      </header>

      {gates.length === 0 ? null : (
        <div role="group" aria-label="Merge readiness" className="grid grid-cols-3 gap-2">
          {gates.map((gate) => (
            <GateRow key={gate.name} gate={gate} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <GitBranch size={16} aria-hidden="true" className="text-fg-muted" />
        {item.headBranch === null ? (
          <span className="text-fg-muted">Unknown branch</span>
        ) : (
          <Bdi className="min-w-0 break-all font-mono">{item.headBranch}</Bdi>
        )}
        <ArrowRight size={14} aria-hidden="true" className="text-fg-muted rtl:-scale-x-100" />
        <Bdi className="font-mono">{item.baseBranch ?? 'default branch'}</Bdi>
      </div>

      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        <dt className="text-fg-muted">Author</dt>
        <dd className="m-0">{item.author === null ? '—' : <Bdi>{item.author}</Bdi>}</dd>
        <dt className="text-fg-muted">Opened</dt>
        <dd className="m-0">
          <time dateTime={item.openedAt} title={formatDateTime(new Date(item.openedAt))}>
            {formatRelative(item.openedAt, now)}
          </time>
          <span className="text-fg-muted">
            {' '}
            · active {formatRelative(item.lastActivityAt, now)}
          </span>
        </dd>
        <dt className="text-fg-muted">Reviewers</dt>
        <dd className="m-0 flex flex-wrap gap-1">
          {item.requestedReviewers.length === 0 ? (
            <span className="text-fg-muted">None requested</span>
          ) : (
            item.requestedReviewers.map((reviewer) => (
              <Badge key={reviewer} variant="outline">
                <Bdi>{reviewer}</Bdi>
              </Badge>
            ))
          )}
        </dd>
        <dt className="text-fg-muted">Labels</dt>
        <dd className="m-0 flex flex-wrap gap-1">
          {item.labels.length === 0 ? (
            <span className="text-fg-muted">None</span>
          ) : (
            item.labels.map((label) => (
              <Badge key={label} variant="secondary">
                <UserText>{label}</UserText>
              </Badge>
            ))
          )}
        </dd>
        <dt className="text-fg-muted">Changes</dt>
        <dd className="m-0">
          <ChangeBar additions={item.additions} deletions={item.deletions} />
        </dd>
      </dl>

      {operator ? (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          {primary === null ? null : (
            <Button
              variant={primary === 'merge' ? 'default' : 'outline'}
              aria-label={`${ACTION_LABEL[primary]} ${item.repository}#${String(item.number)}`}
              onClick={() => onPick(primary, subject)}
            >
              {ACTION_LABEL[primary]}
            </Button>
          )}
          <RowActions subject={subject} onPick={onPick} />
        </div>
      ) : null}
    </article>
  );
}
