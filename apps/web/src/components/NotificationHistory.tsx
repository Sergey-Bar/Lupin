import React from 'react';
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lupin/ui';
import type { DeliverySummary } from '@lupin/shared-contracts';
import { ago } from '../lib/health-view.js';
import { Quiet } from './kit.js';

/** Every report sent or queued, newest first, with the text each one carried. */
const STATUS_VARIANT: Record<
  DeliverySummary['status'],
  'outline' | 'secondary' | 'success' | 'danger'
> = {
  pending: 'outline',
  sending: 'outline',
  sent: 'success',
  failed: 'danger',
};

export function History({ deliveries }: { deliveries: DeliverySummary[] }): React.ReactElement {
  const [open, setOpen] = React.useState<string | null>(null);
  if (deliveries.length === 0) return <Quiet>No report has been sent yet.</Quiet>;
  return (
    <Table aria-label="Delivery history">
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Detail</TableHead>
          <TableHead>
            <span className="sr-only">Report</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.map((delivery) => (
          <React.Fragment key={delivery.id}>
            <TableRow data-testid={`delivery-${delivery.id}`}>
              <TableCell className="text-xs text-fg-muted">
                {ago(delivery.sentAt ?? delivery.scheduledFor)}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[delivery.status]}>{delivery.status}</Badge>
              </TableCell>
              <TableCell className="hidden font-mono text-xs sm:table-cell">
                {delivery.errorCode ?? ''}
              </TableCell>
              <TableCell>
                {delivery.rendered === null ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={open === delivery.id}
                    onClick={() => setOpen(open === delivery.id ? null : delivery.id)}
                  >
                    {open === delivery.id ? 'Hide' : 'Read'}
                  </Button>
                )}
              </TableCell>
            </TableRow>
            {open === delivery.id && delivery.rendered !== null ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <pre className="whitespace-pre-wrap font-sans text-sm">{delivery.rendered}</pre>
                </TableCell>
              </TableRow>
            ) : null}
          </React.Fragment>
        ))}
      </TableBody>
    </Table>
  );
}
