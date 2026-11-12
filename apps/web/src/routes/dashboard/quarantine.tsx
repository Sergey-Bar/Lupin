import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useQuarantine } from '../../hooks/useDashboard.js';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type BadgeProps,
} from '@lupin/ui';
import type { ApiClient, QuarantineEntry } from '../../lib/api.js';
import { QuarantineDecision } from '../../components/QuarantineDecision.js';
import { useViewerRole } from '../../hooks/useViewerRole.js';
import { formatDate } from '../../lib/format.js';
import { Kpi, PageFrame, PageHeader, Paged, Panel, Quiet } from '../../components/kit.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/quarantine',
  validateSearch: (search: Record<string, unknown>): { title?: string; file?: string } => ({
    ...(typeof search['title'] === 'string' ? { title: search['title'].slice(0, 500) } : {}),
    ...(typeof search['file'] === 'string' ? { file: search['file'].slice(0, 500) } : {}),
  }),
  component: function QuarantineRoute() {
    const { title, file } = Route.useSearch();
    return (
      <QuarantinePage
        {...(title !== undefined && file !== undefined ? { prefill: { title, file } } : {})}
      />
    );
  },
});

/**
 * The verdict-to-tone table, and it has to agree with the word.
 *
 * This started life as a nested ternary, and the two non-obvious branches were both
 * inverted: `approved` was `text-error` and `rejected` was `text-success`. On the screen
 * whose whole job is to say which is which, an approval rendered in the failure colour is
 * worse than no colour at all. The values are `Badge` variants so the word and the colour
 * are one element and cannot disagree.
 *
 * `Partial<Record<...>>` on purpose: a verdict the API adds later falls through to the
 * neutral pill below rather than inheriting `pending`'s amber, which would tell a reader
 * that somebody still has to look at it.
 */
const QUARANTINE_STATUS_TONE: Partial<Record<QuarantineEntry['status'], BadgeProps['variant']>> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
  // Released: the test counts again. Neutral, because nothing is left to decide.
  released: 'default',
};

const UNKNOWN_STATUS_TONE = 'default';

export function QuarantinePage({
  api,
  prefill,
}: {
  api?: ApiClient;
  /** A failing test sent from run detail: the form opens with it filled in. */
  prefill?: { title: string; file: string };
}) {
  const { data, isLoading, error, addQuarantine, decide, isUnsaved } = useQuarantine(api);
  const role = useViewerRole();
  const [isAdding, setIsAdding] = useState(prefill !== undefined);
  const [testTitle, setTestTitle] = useState(prefill?.title ?? '');
  const [testFile, setTestFile] = useState(prefill?.file ?? '');
  const [reason, setReason] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <PageFrame data-testid="quarantine-loading">
        <PageHeader title="Quarantine" />
        <Quiet>Reading the quarantine list…</Quiet>
      </PageFrame>
    );
  }

  if (error) {
    return (
      <PageFrame>
        <PageHeader title="Quarantine" />
        <EmptyState
          headingLevel={2}
          data-testid="quarantine-error"
          title="The quarantine list could not be read"
          description={error.message}
        />
      </PageFrame>
    );
  }

  /**
   * React does not await an onSubmit handler, so a rejection would be unhandled rather
   * than rendered. The wrapper discards the promise *after* the async body has attached
   * its own catch, which is what makes a failed add visible.
   */
  const addAsync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTitle || !testFile) return;
    setAddError(null);
    // Optimistic: the entry is in the list the moment the form closes, marked "Saving…".
    setIsAdding(false);
    try {
      await addQuarantine({ testTitle, testFile, reason: reason || undefined });
      setTestTitle('');
      setTestFile('');
      setReason('');
    } catch (err) {
      // The hook has already taken the guess back out of the list. The form reopens with
      // the reader's text and says why, because clearing the fields on a failure would
      // discard the work, which is the second way to lose it.
      setAddError(err instanceof Error ? err.message : 'Could not add the test to quarantine');
      setIsAdding(true);
    }
  };

  const toggle = () => {
    setIsAdding(!isAdding);
    setAddError(null);
  };

  const count = (status: QuarantineEntry['status']) =>
    data.filter((entry) => entry.status === status).length;

  return (
    <PageFrame data-testid="quarantine-page">
      <PageHeader
        title="Quarantine"
        subtitle="Tests held out of the pass rate while someone decides what to do about them"
        actions={
          <Button data-testid="add-quarantine-btn" onClick={toggle} className="min-h-11">
            {isAdding ? 'Cancel' : 'Add to quarantine'}
          </Button>
        }
      />
      <section
        aria-label="Quarantine totals"
        className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4"
      >
        <Kpi label="Quarantined" value={String(data.length)} />
        <Kpi
          label="Pending"
          value={String(count('pending'))}
          tone="text-warning"
          footer="still counted in the pass rate"
        />
        <Kpi
          label="Approved"
          value={String(count('approved'))}
          tone="text-success"
          footer="removed from the pass rate"
        />
        <Kpi
          label="Rejected"
          value={String(count('rejected'))}
          tone="text-danger"
          footer="sent back to be fixed"
        />
      </section>

      {data.length === 0 ? (
        <EmptyState
          headingLevel={2}
          data-testid="quarantine-empty"
          title="No tests in quarantine"
          description="A test added here keeps counting in the pass rate until someone approves it."
        />
      ) : (
        <Panel title="Quarantined tests" data-testid="quarantine-list" className="flex-1">
          <Paged items={data} reservedPx={460} label="quarantine">
            {(page) => (
              <Table aria-label="Quarantined tests">
                <TableHeader>
                  <TableRow>
                    <TableHead>Test</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Quarantined</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Decision</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.map((entry) => (
                    <TableRow
                      key={entry.id}
                      data-testid={`quarantine-item-${entry.id}`}
                      aria-busy={isUnsaved(entry.id) ? true : undefined}
                      className={isUnsaved(entry.id) ? 'opacity-60' : undefined}
                    >
                      <TableCell>
                        {entry.testTitle}
                        {isUnsaved(entry.id) ? (
                          <span className="ms-2 text-xs text-fg-muted">Saving…</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{entry.testFile}</TableCell>
                      <TableCell className="text-fg-muted">
                        {entry.reason ?? 'no reason given'}
                      </TableCell>
                      <TableCell>{formatDate(entry.quarantinedAt, 'not recorded')}</TableCell>
                      <TableCell>
                        {/*
                          `pending` still counts in the pass rate; `approved` is the decision
                          that removes it. The word and the colour sit in one `Badge`.
                        */}
                        <Badge
                          data-testid={`quarantine-status-${entry.id}`}
                          variant={QUARANTINE_STATUS_TONE[entry.status] ?? UNKNOWN_STATUS_TONE}
                        >
                          {entry.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isUnsaved(entry.id) ? null : (
                          <QuarantineDecision
                            entry={entry}
                            viewerRole={role}
                            onDecide={(status, resolution) =>
                              decide(entry.id, { status, resolution })
                            }
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paged>
        </Panel>
      )}

      <Dialog open={isAdding} onOpenChange={(open) => (open ? undefined : setIsAdding(false))}>
        {isAdding ? (
          <DialogContent>
            <form
              data-testid="quarantine-form"
              onSubmit={(event) => void addAsync(event)}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>Quarantine a test</DialogTitle>
              </DialogHeader>
              <Input
                id="quarantine-test-title"
                label="Test title"
                data-testid="input-test-title"
                data-autofocus
                type="text"
                required
                value={testTitle}
                onChange={(e) => setTestTitle(e.target.value)}
              />
              <Input
                id="quarantine-test-file"
                label="Test file"
                data-testid="input-test-file"
                type="text"
                required
                value={testFile}
                onChange={(e) => setTestFile(e.target.value)}
              />
              <Input
                id="quarantine-reason"
                label="Reason (optional)"
                data-testid="input-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {addError && (
                <div
                  role="alert"
                  data-testid="quarantine-add-error"
                  className="text-sm text-danger"
                >
                  {addError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={toggle} className="min-h-11">
                  Cancel
                </Button>
                <Button data-testid="submit-quarantine-btn" type="submit" className="min-h-11">
                  Quarantine
                </Button>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </PageFrame>
  );
}
