import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A read in progress, said the same way on every screen (plan 1795712849115 task 17).
 * `role="status"` with polite announcement, so a screen reader hears "Loading runs" once and
 * is not interrupted; the visible text is short, and the label says what is loading.
 */
export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  /** What is loading, for the announcement: "runs". */
  label?: string | undefined;
  'data-testid'?: string;
}

export const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(
  ({ className, label, 'data-testid': testId = 'loading-state', ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={cn('w-full p-4 text-sm text-text-secondary animate-fade-in', className)}
      {...props}
    >
      {label === undefined || label === '' ? 'Loading…' : `Loading ${label}…`}
    </div>
  ),
);

LoadingState.displayName = 'LoadingState';
