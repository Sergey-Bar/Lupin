import React from 'react';
import { Button } from '@lupin/ui';
import { actionsFor, type ActionKind, type Subject } from '../lib/github-actions.js';
import { ACTION_LABEL } from './GithubActionDialog.js';

/**
 * The controls that start a write: a menu on every row, and a bar over a selection.
 *
 * Only an operator is shown either; the API enforces the role regardless, so these decide what
 * to draw and nothing else. Both are native `<select>`s and checkboxes, which are keyboard and
 * screen-reader complete by default and mirror in a right-to-left page without help.
 */
export const subjectKey = (subject: Pick<Subject, 'projectId' | 'number'>) =>
  `${subject.projectId}#${String(subject.number)}`;

/** Actions that make sense for many items at once. A merge and a release are one at a time. */
export function bulkActionsFor(subjects: readonly Subject[]): ActionKind[] {
  if (subjects.length === 0) return [];
  const each = subjects.map((subject) => new Set(actionsFor(subject)));
  const common = [...(each[0] ?? [])].filter((kind) => each.every((set) => set.has(kind)));
  return common.filter((kind) => kind !== 'merge' && kind !== 'createRelease');
}

export function RowActions({
  subject,
  onPick,
}: {
  subject: Subject;
  onPick: (kind: ActionKind, subject: Subject) => void;
}): React.ReactElement {
  return (
    <select
      aria-label={`Actions for ${subject.repository}#${String(subject.number)}`}
      value=""
      onChange={(event) => {
        if (event.target.value !== '') onPick(event.target.value as ActionKind, subject);
      }}
      className="h-9 w-24 rounded-md border border-border-strong bg-transparent px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      <option value="">Actions</option>
      {actionsFor(subject).map((kind) => (
        <option key={kind} value={kind}>
          {ACTION_LABEL[kind]}
        </option>
      ))}
    </select>
  );
}

export function BulkBar({
  subjects,
  onPick,
  onClear,
}: {
  subjects: readonly Subject[];
  onPick: (kind: ActionKind, subjects: readonly Subject[]) => void;
  onClear: () => void;
}): React.ReactElement | null {
  if (subjects.length === 0) return null;
  const kinds = bulkActionsFor(subjects);
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted px-4 py-2"
    >
      <span className="text-sm font-medium" aria-live="polite">
        {String(subjects.length)} selected
      </span>
      {kinds.length === 0 ? (
        <span className="text-sm text-fg-muted">No action fits all of them.</span>
      ) : (
        kinds.map((kind) => (
          <Button key={kind} variant="outline" onClick={() => onPick(kind, subjects)}>
            {ACTION_LABEL[kind]}
          </Button>
        ))
      )}
      <Button variant="outline" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
