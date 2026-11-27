import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A read that failed, said the same way on every screen (plan 1795712849115 task 17): what
 * could not be loaded, the reason in plain words, and one way out. `role="alert"` so a screen
 * reader hears it once; the technical detail, when there is one, sits behind a fold rather
 * than in the sentence a person reads.
 */
export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** What could not be loaded: "Could not load the runs". */
  title: string;
  /** Why, in plain words, and what to try. */
  description: string;
  /** The original error text, shown only when asked for. */
  detail?: string | undefined;
  /** One way out: a retry, or a link to where it is fixed. */
  action?: ReactNode;
  'data-testid'?: string;
}

export const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(
  (
    {
      className,
      title,
      description,
      detail,
      action,
      'data-testid': testId = 'error-state',
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      role="alert"
      data-testid={testId}
      className={cn(
        'flex w-full flex-col items-start gap-2 rounded-lg border border-border-default bg-bg-elevated p-4 text-start animate-fade-in',
        className,
      )}
      {...props}
    >
      <p className="text-sm font-semibold text-danger">{title}</p>
      <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
      {detail === undefined || detail === '' ? null : (
        <details className="text-xs text-text-secondary">
          <summary className="cursor-pointer">Technical details</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono">{detail}</pre>
        </details>
      )}
      {action === undefined ? null : <div className="mt-1">{action}</div>}
    </div>
  ),
);

ErrorState.displayName = 'ErrorState';
