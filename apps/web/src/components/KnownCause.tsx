import React from 'react';
import { Button, Input } from '@lupin/ui';

/**
 * The reason a cause is known (plan task 12): asked for when someone labels a cause a known
 * issue and has no issue to link, and shown on every later occurrence. Known is a label, never
 * a pass: the cause's failures are still counted.
 */
export function KnownReasonForm({
  onSave,
  onCancel,
}: {
  onSave: (reason: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [reason, setReason] = React.useState('');
  const id = React.useId();
  return (
    <form
      aria-label="Why is this cause known"
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim() !== '') onSave(reason.trim());
      }}
    >
      <Input
        id={`${id}-reason`}
        label="Why it is known"
        value={reason}
        required
        onChange={(event) => setReason(event.target.value)}
      />
      <Button type="submit" variant="outline" disabled={reason.trim() === ''}>
        Save
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** "Known: …" under a cause, when it carries a reason. */
export function KnownReason({ reason }: { reason: string | null | undefined }) {
  if (reason === null || reason === undefined || reason === '') return null;
  return (
    <p data-testid="known-reason" className="text-xs text-fg-muted">
      {`Known: ${reason} · still counted as a failure`}
    </p>
  );
}
