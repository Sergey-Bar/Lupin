import React from 'react';
import { Quiet } from './kit.js';

/**
 * A read that failed, said the same way on every panel: the plain sentence `useResource`
 * made from it, and the original code under "Technical details" when it was rewritten.
 */
export function ReadFailed({
  failure,
  ...props
}: {
  failure: { status: 'error'; message: string; detail?: string };
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'role'>): React.ReactElement {
  return (
    <Quiet role="alert" {...props}>
      {failure.message}
      {failure.detail === undefined ? null : (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
            Technical details
          </summary>
          <span className="font-mono">{failure.detail}</span>
        </details>
      )}
    </Quiet>
  );
}
