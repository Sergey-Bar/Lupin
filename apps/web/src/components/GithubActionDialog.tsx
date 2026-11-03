import React from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  Textarea,
} from '@lupin/ui';
import type { GithubActionResult } from '@lupin/shared-contracts';
import type { GithubClient } from '../lib/github-client.js';
import {
  buildActions,
  needsInput,
  parseList,
  validate,
  type ActionKind,
  type Form,
  type Subject,
} from '../lib/github-actions.js';
import { failureText } from '../lib/roles.js';
import { formatRelative } from '../lib/intl.js';
import { Bdi, UserText } from './Bidi.js';
import { useToast } from './Toasts.js';

/**
 * One dialog for every write, single or bulk.
 *
 * It states what will happen to what, asks for what the action needs, and only then calls the
 * API. A bulk action must be previewed first: the preview is a dry run, which asks GitHub for
 * nothing and spends none of its request budget, and its per-item verdicts are shown before the
 * button that applies it is enabled. A merge shows what the person is about to override (failing
 * checks, no approval, conflicts) in words, and names the commit it looked at, so GitHub refuses
 * it if the branch has moved since.
 *
 * The dialog never closes on its own result: what each item did is the thing to read.
 */
export const ACTION_LABEL: Record<ActionKind, string> = {
  merge: 'Merge',
  updateBranch: 'Update branch',
  review: 'Review',
  requestReviewers: 'Request reviewers',
  comment: 'Comment',
  labels: 'Set labels',
  assign: 'Assign',
  close: 'Close item',
  reopen: 'Reopen item',
  protectBranch: 'Protect default branch',
  createRelease: 'Create release',
};

const TEXT_LABEL: Partial<Record<ActionKind, { label: string; hint: string }>> = {
  comment: { label: 'Comment', hint: 'Markdown is supported.' },
  labels: {
    label: 'Labels',
    hint: 'The complete list, separated by commas. Leave it empty to remove them all.',
  },
  assign: {
    label: 'Assignees',
    hint: 'GitHub usernames, separated by commas. Leave it empty to unassign everyone.',
  },
  requestReviewers: { label: 'Reviewers', hint: 'GitHub usernames, separated by commas.' },
  review: { label: 'Review', hint: 'Required for a change request or a comment.' },
  createRelease: { label: 'Release notes', hint: 'Markdown is supported. Optional.' },
};

/** What a merge would override, as sentences, from what the list showed. */
export function cautionsFor(subject: Subject): string[] {
  const found: string[] = [];
  if (subject.reviewDecision === 'changes_requested') found.push('A reviewer asked for changes.');
  else if (subject.reviewDecision !== 'approved') found.push('It has not been approved.');
  if (subject.checksState === 'failure') found.push('Its checks are failing.');
  if (subject.checksState === 'pending') found.push('Its checks are still running.');
  if (subject.mergeableState === 'dirty') found.push('It has merge conflicts.');
  if (subject.mergeableState === 'behind') found.push('Its branch is behind the base branch.');
  return found;
}

const OUTCOME: Record<
  GithubActionResult['outcome'],
  { word: string; variant: 'success' | 'danger' | 'warning' | 'outline' }
> = {
  ok: { word: 'Done', variant: 'success' },
  planned: { word: 'Would run', variant: 'outline' },
  refused: { word: 'Refused', variant: 'warning' },
  failed: { word: 'Failed', variant: 'danger' },
};

const SHOWN = 5;

export function GithubActionDialog({
  kind,
  subjects,
  github,
  now = () => new Date(),
  onClose,
  onDone,
}: {
  kind: ActionKind;
  subjects: readonly Subject[];
  github: GithubClient;
  now?: () => Date;
  onClose: () => void;
  /** Called once after anything was written, so the list can reload. */
  onDone: () => void;
}): React.ReactElement {
  const toast = useToast();
  const bulk = subjects.length > 1;
  const [form, setForm] = React.useState<Form>({
    text: '',
    method: 'squash',
    event: 'APPROVE',
    tag: '',
    name: '',
    releaseType: 'release',
  });
  const [busy, setBusy] = React.useState(false);
  const [previewed, setPreviewed] = React.useState(false);
  const [results, setResults] = React.useState<GithubActionResult[] | null>(null);
  const [dry, setDry] = React.useState(true);
  const problem = validate(kind, subjects, form);
  const label = ACTION_LABEL[kind];
  const text = TEXT_LABEL[kind];

  // Any change to the form makes the earlier preview stale: it described a different request.
  const edit = (change: Partial<Form>) => {
    setForm((current) => ({ ...current, ...change }));
    setPreviewed(false);
    setResults(null);
  };

  const run = (dryRun: boolean) => {
    setBusy(true);
    github
      .runActions({ dryRun, actions: buildActions(kind, subjects, form) })
      .then((response) => {
        setResults(response.results);
        setDry(dryRun);
        if (dryRun) {
          setPreviewed(true);
          return;
        }
        const done = response.results.filter((result) => result.outcome === 'ok').length;
        toast({
          tone: done === response.results.length ? 'success' : 'info',
          title: `${label}: ${String(done)} of ${String(response.results.length)} done`,
        });
        if (done > 0) onDone();
      })
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: `${label} failed`,
          description: failureText(error, 'The request did not reach the server'),
        }),
      )
      .finally(() => setBusy(false));
  };

  const applied = results !== null && !dry;
  const cautions = kind === 'merge' && subjects[0] !== undefined ? cautionsFor(subjects[0]) : [];
  const needsPreview = bulk && !previewed;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {bulk
              ? `${label}: ${String(subjects.length)} ${subjects[0]?.kind === 'repo' ? 'repositories' : 'items'}`
              : subjects[0]?.kind === 'repo'
                ? `${label}: ${subjects[0].repository}`
                : `${label} ${subjects[0]?.repository ?? ''}#${String(subjects[0]?.number ?? '')}`}
          </DialogTitle>
          <DialogDescription>
            {bulk
              ? 'Preview first. A preview asks GitHub for nothing and shows what each item would do.'
              : kind === 'protectBranch'
                ? 'Requires one approving review before anything is merged into the default branch. A branch that already has protection is left exactly as it is.'
                : subjects[0]?.title}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 pb-2">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Targets">
            {subjects.slice(0, SHOWN).map((subject) => (
              <li key={`${subject.projectId}#${String(subject.number)}`} className="flex gap-2">
                <Bdi className="shrink-0 font-mono text-xs text-fg-muted">
                  {subject.kind === 'repo'
                    ? subject.repository
                    : `${subject.repository}#${String(subject.number)}`}
                </Bdi>
                {subject.kind === 'repo' ? null : (
                  <UserText className="truncate">{subject.title}</UserText>
                )}
              </li>
            ))}
            {subjects.length > SHOWN ? (
              <li className="text-fg-muted">and {String(subjects.length - SHOWN)} more</li>
            ) : null}
          </ul>

          {cautions.length > 0 ? (
            <div role="alert" className="rounded-md border border-warning p-3 text-sm">
              <p className="m-0 font-medium">Merging this will go against what the list shows:</p>
              <ul className="m-0 mt-1 list-disc ps-5">
                {cautions.map((caution) => (
                  <li key={caution}>{caution}</li>
                ))}
              </ul>
              <p className="m-0 mt-1 text-fg-muted">
                GitHub still decides whether it can merge. This only tells you what you are
                choosing.
              </p>
            </div>
          ) : null}

          {kind === 'merge' ? (
            <Select
              id="merge-method"
              label="How to merge"
              value={form.method}
              onChange={(event) => edit({ method: event.target.value as Form['method'] })}
              options={[
                { value: 'squash', label: 'Squash and merge' },
                { value: 'merge', label: 'Create a merge commit' },
                { value: 'rebase', label: 'Rebase and merge' },
              ]}
            />
          ) : null}

          {kind === 'createRelease' ? (
            <>
              <Input
                id="release-tag"
                label="Tag"
                placeholder="v1.2.0"
                dir="ltr"
                value={form.tag}
                onChange={(event) => edit({ tag: event.target.value })}
              />
              <Input
                id="release-name"
                label="Title (optional)"
                dir="auto"
                value={form.name}
                onChange={(event) => edit({ name: event.target.value })}
              />
              <Select
                id="release-type"
                label="Type"
                value={form.releaseType}
                onChange={(event) =>
                  edit({ releaseType: event.target.value as Form['releaseType'] })
                }
                options={[
                  { value: 'release', label: 'Release' },
                  { value: 'prerelease', label: 'Pre-release' },
                  { value: 'draft', label: 'Draft (not published)' },
                ]}
              />
            </>
          ) : null}

          {kind === 'review' ? (
            <Select
              id="review-event"
              label="Decision"
              value={form.event}
              onChange={(event) => edit({ event: event.target.value as Form['event'] })}
              options={[
                { value: 'APPROVE', label: 'Approve' },
                { value: 'REQUEST_CHANGES', label: 'Request changes' },
                { value: 'COMMENT', label: 'Comment only' },
              ]}
            />
          ) : null}

          {needsInput(kind) && text !== undefined ? (
            <Textarea
              id="action-text"
              label={text.label}
              helperText={text.hint}
              dir="auto"
              rows={kind === 'comment' || kind === 'review' ? 5 : 2}
              value={form.text}
              onChange={(event) => edit({ text: event.target.value })}
            />
          ) : null}

          {kind === 'labels' || kind === 'assign' || kind === 'requestReviewers' ? (
            <p className="m-0 text-xs text-fg-muted">
              {String(parseList(form.text).length)} in the list.
            </p>
          ) : null}

          {problem === null || results !== null ? null : (
            <p role="status" className="m-0 text-sm text-fg-muted">
              {problem}
            </p>
          )}

          {results === null ? null : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Results">
              {results.map((result, index) => (
                <li
                  key={`${result.target}-${String(index)}`}
                  className="flex flex-col gap-0.5 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={OUTCOME[result.outcome].variant}>
                      {OUTCOME[result.outcome].word}
                    </Badge>
                    <Bdi className="font-mono text-xs">{result.target}</Bdi>
                  </div>
                  <span className="text-fg-muted">
                    {result.message}
                    {result.retryAt === null
                      ? ''
                      : ` Try again ${formatRelative(result.retryAt, now())}.`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {applied ? 'Done' : 'Cancel'}
          </Button>
          {applied ? null : (
            <>
              {bulk || kind === 'merge' ? (
                <Button
                  variant="outline"
                  disabled={busy || problem !== null}
                  onClick={() => run(true)}
                >
                  Preview
                </Button>
              ) : null}
              <Button
                disabled={busy || problem !== null || needsPreview}
                onClick={() => run(false)}
                title={needsPreview ? 'Preview this first' : undefined}
              >
                {busy ? 'Working…' : bulk ? `Apply to ${String(subjects.length)} items` : label}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
