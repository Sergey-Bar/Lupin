import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GithubActionsBody, GithubActionsResponse } from '@lupin/shared-contracts';
import type { GithubClient } from '../lib/github-client.js';
import type { Subject } from '../lib/github-actions.js';
import { GithubActionDialog, cautionsFor } from './GithubActionDialog.js';
import { ToastProvider } from './Toasts.js';

const subject = (overrides: Partial<Subject> = {}): Subject => ({
  kind: 'pull',
  projectId: 'p1',
  repository: 'octo/service',
  number: 7,
  title: 'Fix the login bug',
  state: 'open',
  draft: false,
  headSha: 'abcdef1',
  labels: [],
  assignees: [],
  reviewDecision: 'approved',
  checksState: 'success',
  mergeableState: 'clean',
  ...overrides,
});

const answer = (
  dryRun: boolean,
  outcomes: Array<'ok' | 'planned' | 'refused' | 'failed'>,
  message = 'Done.',
): GithubActionsResponse => ({
  dryRun,
  results: outcomes.map((outcome, index) => ({
    action: 'x',
    target: `octo/service#${String(index + 1)}`,
    outcome,
    message,
    retryAt: null,
  })),
});

function setup(
  reply: (dryRun: boolean) => GithubActionsResponse | Promise<never> = (dryRun) =>
    answer(dryRun, [dryRun ? 'planned' : 'ok']),
) {
  const runActions = vi.fn(async (body: GithubActionsBody) => reply(body.dryRun));
  const github = { runActions } as unknown as GithubClient;
  const onClose = vi.fn();
  const onDone = vi.fn();
  const view = (kind: Parameters<typeof GithubActionDialog>[0]['kind'], subjects: Subject[]) =>
    render(
      <ToastProvider>
        <GithubActionDialog
          kind={kind}
          subjects={subjects}
          github={github}
          onClose={onClose}
          onDone={onDone}
        />
      </ToastProvider>,
    );
  return { runActions, onClose, onDone, view };
}

describe('cautionsFor', () => {
  it('lists what a merge would override, in words, and nothing for a clean pull request', () => {
    expect(cautionsFor(subject())).toEqual([]);
    expect(
      cautionsFor(
        subject({
          reviewDecision: 'changes_requested',
          checksState: 'failure',
          mergeableState: 'dirty',
        }),
      ),
    ).toEqual([
      'A reviewer asked for changes.',
      'Its checks are failing.',
      'It has merge conflicts.',
    ]);
    expect(
      cautionsFor(subject({ reviewDecision: 'review_required', checksState: 'pending' })),
    ).toEqual(['It has not been approved.', 'Its checks are still running.']);
  });
});

describe('a single action', () => {
  it('will not comment until there is something to say, then sends it and reports the result', async () => {
    const t = setup();
    t.view('comment', [subject()]);
    const submit = screen.getByRole('button', { name: 'Comment' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Thanks, merging.');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => expect(t.onDone).toHaveBeenCalledTimes(1));
    expect(t.runActions).toHaveBeenCalledWith({
      dryRun: false,
      actions: [{ action: 'comment', projectId: 'p1', number: 7, body: 'Thanks, merging.' }],
    });
    const results = screen.getByRole('list', { name: 'Results' });
    expect(within(results).getByText('Done')).toBeInTheDocument();
    // The dialog stays open to show what happened, and offers Close.
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('closes or reopens with no form at all', async () => {
    const t = setup();
    t.view('close', [subject()]);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close item' }));
    await waitFor(() => expect(t.runActions).toHaveBeenCalled());
    expect(t.runActions.mock.calls[0]?.[0].actions[0]).toMatchObject({
      action: 'close',
      number: 7,
    });
  });

  it('merges the commit the person looked at, by the method chosen, after naming what it overrides', async () => {
    const t = setup();
    t.view('merge', [subject({ checksState: 'failure', reviewDecision: 'review_required' })]);
    expect(screen.getByRole('alert')).toHaveTextContent('It has not been approved.');
    expect(screen.getByRole('alert')).toHaveTextContent('Its checks are failing.');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'How to merge' }), 'rebase');
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(t.runActions).toHaveBeenCalled());
    expect(t.runActions.mock.calls[0]?.[0]).toEqual({
      dryRun: false,
      actions: [{ action: 'merge', projectId: 'p1', number: 7, sha: 'abcdef1', method: 'rebase' }],
    });
  });

  it('shows a refusal in words and does not claim the list changed', async () => {
    const t = setup(() =>
      answer(false, ['refused'], 'The pull request changed after you looked at it.'),
    );
    t.view('merge', [subject()]);
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(await screen.findByText('Refused')).toBeInTheDocument();
    expect(screen.getByText(/changed after you looked/u)).toBeInTheDocument();
    expect(t.onDone).not.toHaveBeenCalled();
  });

  it('keeps the dialog usable when the request itself fails', async () => {
    const t = setup(() => Promise.reject(new Error('offline')) as Promise<never>);
    t.view('close', [subject()]);
    await userEvent.click(screen.getByRole('button', { name: 'Close item' }));
    expect(await screen.findByText('Close item failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close item' })).toBeEnabled();
    expect(t.onDone).not.toHaveBeenCalled();
  });

  it('needs an explanation for a change request but not for an approval', async () => {
    const t = setup();
    t.view('review', [subject()]);
    const submit = screen.getByRole('button', { name: 'Review' });
    expect(submit).toBeEnabled();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Decision' }),
      'REQUEST_CHANGES',
    );
    expect(submit).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Explain the review');
    await userEvent.type(screen.getByRole('textbox', { name: 'Review' }), 'Add a test.');
    expect(submit).toBeEnabled();
  });

  it('writes Arabic in its own direction', async () => {
    const t = setup();
    t.view('comment', [subject()]);
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveAttribute('dir', 'auto');
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'شكرا');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(t.runActions).toHaveBeenCalled());
    expect(t.runActions.mock.calls[0]?.[0].actions[0]).toMatchObject({ body: 'شكرا' });
  });
});

describe('several at once', () => {
  const three = [1, 2, 3].map((number) => subject({ number, title: `Item ${String(number)}` }));

  it('lists the first few targets and counts the rest', () => {
    const t = setup();
    t.view(
      'close',
      Array.from({ length: 8 }, (_, index) => subject({ number: index + 1 })),
    );
    expect(
      within(screen.getByRole('list', { name: 'Targets' })).getAllByRole('listitem'),
    ).toHaveLength(6);
    expect(screen.getByText('and 3 more')).toBeInTheDocument();
  });

  it('cannot be applied before it has been previewed, and the preview writes nothing', async () => {
    const t = setup();
    t.view('close', three);
    const apply = screen.getByRole('button', { name: 'Apply to 3 items' });
    expect(apply).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(apply).toBeEnabled());
    expect(t.runActions.mock.calls[0]?.[0].dryRun).toBe(true);
    expect(t.onDone).not.toHaveBeenCalled();
    expect(screen.getByText('Would run')).toBeInTheDocument();

    await userEvent.click(apply);
    await waitFor(() => expect(t.onDone).toHaveBeenCalled());
    expect(t.runActions.mock.calls[1]?.[0].dryRun).toBe(false);
    expect(t.runActions.mock.calls[1]?.[0].actions).toHaveLength(3);
  });

  it('forgets a preview when the request changes, because it described a different one', async () => {
    const t = setup();
    t.view('comment', three);
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Duplicate of #1');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const apply = screen.getByRole('button', { name: 'Apply to 3 items' });
    await waitFor(() => expect(apply).toBeEnabled());

    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), '!');
    expect(apply).toBeDisabled();
  });

  it('reports each item, including the ones that failed, and says when to come back after a rate limit', async () => {
    const t = setup(() => ({
      dryRun: false,
      results: [
        {
          action: 'close',
          target: 'octo/service#1',
          outcome: 'ok',
          message: 'Done.',
          retryAt: null,
        },
        {
          action: 'close',
          target: 'octo/service#2',
          outcome: 'failed',
          message: 'GitHub’s rate limit was reached. Try again later.',
          retryAt: new Date(Date.now() + 3_660_000).toISOString(),
        },
      ],
    }));
    t.view('close', three);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Apply to 3 items' }));
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/Try again in 1 hour/u)).toBeInTheDocument();
    // One of two succeeded: the list reloads.
    expect(t.onDone).toHaveBeenCalledTimes(1);
  });
});
