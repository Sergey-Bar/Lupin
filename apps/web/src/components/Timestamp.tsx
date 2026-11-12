import React from 'react';
import { formatDateTime, formatRelative } from '../lib/intl.js';

export interface TimestampProps {
  value: string | null | undefined;
  /** What to say when there is no time. Required: "Not started" and "Unknown" are different claims. */
  empty: string;
  /** The clock to measure from. Tests pass one; the product reads the current time. */
  now?: Date;
}

/**
 * A time as a person scans it: "5 minutes ago", on one line.
 *
 * The full zoned time (`formatDateTime`, ledger W-7a) stays in the `title` and the
 * `dateTime` attribute, so the precise value is one hover away and is still in the markup.
 * A full `11/9/2026, 6:39:40 AM GMT+2` in a narrow column wrapped to two lines.
 */
export function Timestamp({ value, empty, now }: TimestampProps): React.ReactElement {
  const at = value ? new Date(value) : null;
  if (at === null || value == null || Number.isNaN(at.getTime())) return <>{empty}</>;
  return (
    <time dateTime={value} title={formatDateTime(at)} className="whitespace-nowrap">
      {formatRelative(value, now ?? new Date())}
    </time>
  );
}
