import React from 'react';
import { Badge, Button, Input, Textarea } from '@lupin/ui';
import type { ReleaseSignoff, SignoffBody } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import { useViewerRole } from '../hooks/useViewerRole.js';
import { roleMeets } from '../route-manifest.js';
import { Panel } from './kit.js';
import { ReadFailed } from './ReadFailed.js';
import { useToast } from './Toasts.js';
import { failureText } from '../lib/roles.js';

export interface SignoffSource {
  list: (projectId: string) => Promise<ReleaseSignoff[]>;
  record: (projectId: string, body: SignoffBody) => Promise<ReleaseSignoff>;
}

const VERDICT_WORD: Record<ReleaseSignoff['verdict'], string> = {
  go: 'Go',
  caution: 'Caution',
  'no-go': 'No-go',
};

/** One decision, in a sentence that says when it overrode the verdict. */
function SignoffLine({ signoff }: { signoff: ReleaseSignoff }): React.ReactElement {
  return (
    <p data-testid="signoff-latest" className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={signoff.decision === 'ship' ? 'success' : 'warning'}>
        {signoff.decision === 'ship' ? 'Ship' : 'Hold'}
      </Badge>
      {signoff.override ? <Badge variant="danger">Override</Badge> : null}
      <span className="font-mono text-xs">{signoff.commit.slice(0, 7)}</span>
      <span className="text-fg-muted">
        by {signoff.actor} against a {VERDICT_WORD[signoff.verdict]} verdict: {signoff.reason}
      </span>
    </p>
  );
}

/**
 * Release sign-off on Home (plan Wave 1 task 5): the latest decision beside the verdict, and
 * the form to record one. The server records the verdict it computes, never one sent from here;
 * shipping against no-go is an admin's override and is labelled one.
 */
export function ReleaseSignoffPanel({
  source,
  projectId,
}: {
  source: SignoffSource;
  projectId: string;
}): React.ReactElement {
  const toast = useToast();
  const role = useViewerRole();
  const id = React.useId();
  const [version, setVersion] = React.useState(0);
  const list = useResource(() => source.list(projectId), [source, projectId, version]);
  const [commit, setCommit] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const allowed = roleMeets('operator', role);
  const record = (decision: SignoffBody['decision']) => {
    setBusy(true);
    source
      .record(projectId, { commit: commit.trim(), decision, reason: reason.trim() })
      .then((saved) => {
        toast({
          tone: 'success',
          title: saved.override ? 'Shipped as an override' : `Recorded: ${decision}`,
        });
        setReason('');
        setVersion((count) => count + 1);
      })
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'The sign-off was not recorded',
          description: failureText(error, 'The request failed'),
        }),
      )
      .finally(() => setBusy(false));
  };
  const ready = allowed && !busy && /^[0-9a-f]{7,40}$/u.test(commit.trim()) && reason.trim() !== '';
  return (
    <Panel title="Release sign-off" data-testid="release-signoff">
      {list.status === 'error' ? (
        <ReadFailed failure={list} />
      ) : list.status === 'ready' && list.value[0] !== undefined ? (
        <SignoffLine signoff={list.value[0]} />
      ) : list.status === 'ready' ? (
        <p className="text-sm text-fg-muted">
          Nobody has signed off a release of this project yet.
        </p>
      ) : null}
      <form
        aria-label="Sign off a release"
        className="mt-3 grid gap-2"
        onSubmit={(event) => event.preventDefault()}
      >
        <Input
          id={`${id}-commit`}
          label="Commit"
          placeholder="abc1234"
          value={commit}
          disabled={!allowed}
          onChange={(event) => setCommit(event.target.value)}
        />
        <Textarea
          id={`${id}-reason`}
          label="Reason (required)"
          rows={2}
          value={reason}
          disabled={!allowed}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={!ready} onClick={() => record('ship')}>
            Ship
          </Button>
          <Button type="button" variant="outline" disabled={!ready} onClick={() => record('hold')}>
            Hold
          </Button>
          {allowed ? null : (
            <span className="text-xs text-fg-muted">An operator or admin signs off a release.</span>
          )}
        </div>
      </form>
    </Panel>
  );
}
