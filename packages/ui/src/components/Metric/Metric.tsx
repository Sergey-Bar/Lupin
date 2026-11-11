import React from 'react';
import { cn } from '../../lib/utils.js';

/** A change with its sign written out; `−` is the minus sign, not a hyphen. */
function signed(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return `${sign}${String(Math.abs(delta))}`;
}

/** Colour of the change: muted when there is none, else good or bad by direction. */
function deltaTone(delta: number | undefined, lowerIsBetter: boolean): string {
  if (delta === undefined || delta === 0) return 'text-fg-muted';
  return delta > 0 !== lowerIsBetter ? 'text-success' : 'text-danger';
}

/**
 * One reading: the value with its unit, the change, and what it is compared with, so a number
 * is never shown without the context that says whether it is good (Vercel, Apple Health).
 * A rise is good unless `lowerIsBetter`; with no `delta` there is nothing to compare, and no
 * arrow or colour is drawn.
 */
export function Metric({
  label,
  value,
  unit,
  delta,
  comparedWith,
  lowerIsBetter = false,
  size = 'md',
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: number;
  comparedWith?: string;
  lowerIsBetter?: boolean;
  size?: 'md' | 'lg';
  testId?: string;
}): React.ReactElement {
  const id = React.useId();
  const deltaText = delta === undefined ? null : signed(delta);
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-0.5">
      <span className="flex items-baseline gap-1">
        <span
          {...(testId === undefined ? {} : { 'data-testid': testId })}
          className={cn(
            'font-display font-semibold tracking-tight tabular-nums text-fg',
            size === 'lg' ? 'text-4xl' : 'text-2xl',
          )}
        >
          {value}
        </span>
        {unit === undefined ? null : <span className="text-sm text-fg-muted">{unit}</span>}
        {deltaText === null ? null : (
          <span
            className={cn('ms-1 text-xs font-medium tabular-nums', deltaTone(delta, lowerIsBetter))}
          >
            {deltaText}
          </span>
        )}
      </span>
      <span id={id} className="text-xs text-fg-muted">
        {label}
      </span>
      {comparedWith === undefined || deltaText === null ? null : (
        <span className="text-xs text-fg-muted">vs {comparedWith}</span>
      )}
    </div>
  );
}
