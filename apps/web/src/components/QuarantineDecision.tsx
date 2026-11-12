import React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@lupin/ui';
import type { QuarantineEntry } from '../lib/api.js';
import { roleMeets, type ViewerRole } from '../route-manifest.js';

type Decision = 'approved' | 'rejected' | 'released';

/** The moves each state allows, as the API's `QUARANTINE_TRANSITIONS` does. */
const MOVES: Record<QuarantineEntry['status'], readonly Decision[]> = {
  pending: ['approved', 'rejected'],
  approved: ['released'],
  rejected: [],
  released: [],
};

const COPY: Record<Decision, { label: string; title: string; effect: string }> = {
  approved: {
    label: 'Approve',
    title: 'Approve the quarantine?',
    effect: 'The test stops counting in the pass rate until it is released.',
  },
  rejected: {
    label: 'Reject',
    title: 'Reject the quarantine?',
    effect: 'The test keeps counting in the pass rate and goes back to be fixed.',
  },
  released: {
    label: 'Release',
    title: 'Release the test?',
    effect: 'The test counts in the pass rate again.',
  },
};

/**
 * Approve, reject or release one quarantine entry (plan Wave 1 task 1). A reason is required
 * because the API records it in the audit trail. A viewer sees the controls disabled and why.
 */
export function QuarantineDecision({
  entry,
  viewerRole,
  onDecide,
}: {
  entry: QuarantineEntry;
  viewerRole: ViewerRole | null;
  onDecide: (status: Decision, resolution: string) => Promise<void>;
}): React.ReactElement | null {
  const [open, setOpen] = React.useState<Decision | null>(null);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // A status a newer API adds offers no move rather than crashing the row.
  const moves = (MOVES as Partial<Record<string, readonly Decision[]>>)[entry.status] ?? [];
  if (moves.length === 0) return null;
  const allowed = roleMeets('operator', viewerRole);
  const close = () => {
    setOpen(null);
    setReason('');
    setError(null);
  };
  return (
    <div className="flex flex-wrap gap-1">
      {moves.map((move) => (
        <Button
          key={move}
          type="button"
          size="sm"
          variant="outline"
          disabled={!allowed}
          title={allowed ? undefined : 'An operator or admin decides quarantine'}
          onClick={() => setOpen(move)}
        >
          {COPY[move].label}
        </Button>
      ))}
      <Dialog open={open !== null} onOpenChange={(next) => (next ? undefined : close())}>
        {open === null ? null : (
          <DialogContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (reason.trim() === '') return;
                setBusy(true);
                setError(null);
                onDecide(open, reason.trim())
                  .then(close)
                  .catch((failure: unknown) => {
                    const detail = (failure as { detail?: unknown }).detail;
                    setError(typeof detail === 'string' ? detail : 'The decision was not saved.');
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <DialogHeader>
                <DialogTitle>{COPY[open].title}</DialogTitle>
                <DialogDescription>{COPY[open].effect}</DialogDescription>
              </DialogHeader>
              <Textarea
                id={`quarantine-reason-${entry.id}`}
                label="Reason (required)"
                value={reason}
                data-autofocus
                onChange={(event) => setReason(event.target.value)}
              />
              {error === null ? null : (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || reason.trim() === ''}>
                  {COPY[open].label}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
