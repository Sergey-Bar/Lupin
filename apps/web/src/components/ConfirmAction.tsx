import React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@lupin/ui';

/**
 * A destructive action that asks first (ledger MNT-185): the button opens a dialog naming
 * what will happen, and only its confirm button acts. With `typed`, the confirm button stays
 * off until that name is typed, for an action that cannot be undone and is easy to aim at the
 * wrong row: revoking a token, removing a member, removing the GitHub App.
 */
export function ConfirmAction({
  label,
  title,
  consequence,
  typed,
  onConfirm,
  size = 'sm',
  variant = 'ghost',
  disabled,
}: {
  /** The button's own name; the confirm button reads "Yes, <label in lower case>". */
  label: string;
  title: string;
  /** One sentence: what changes, for whom, and whether it can be undone. */
  consequence: string;
  typed?: string;
  onConfirm: () => unknown;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'outline' | 'destructive';
  disabled?: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [entered, setEntered] = React.useState('');
  const id = React.useId();
  const ready = typed === undefined || entered === typed;
  const close = () => {
    setOpen(false);
    setEntered('');
  };
  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        {...(disabled === undefined ? {} : { disabled })}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        {open ? (
          <DialogContent>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!ready) return;
                close();
                void onConfirm();
              }}
            >
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{consequence}</DialogDescription>
              </DialogHeader>
              {typed === undefined ? null : (
                <Input
                  id={`${id}-typed`}
                  label={`Type ${typed} to confirm`}
                  value={entered}
                  autoComplete="off"
                  data-autofocus
                  onChange={(event) => setEntered(event.target.value)}
                />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={!ready}>
                  {`Yes, ${label.toLowerCase()}`}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
