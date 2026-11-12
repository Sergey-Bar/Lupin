import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export type WordmarkSize = 'sm' | 'md' | 'lg';

const SIZE: Record<WordmarkSize, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-3xl',
};

export interface WordmarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** `md` is the chrome size; `lg` is for a sign-in or setup screen. */
  size?: WordmarkSize;
  /**
   * Hide it from assistive technology. Use it when a heading on the same screen already
   * names the place, so a screen reader does not hear the product name twice.
   */
  decorative?: boolean;
}

/**
 * The product's name, set as type: "Lupin." in Geist, semibold, tight tracking, with the
 * full stop in the accent. Lupin has no logo mark. This component is the brand, and the
 * site's nav and footer draw the same shape.
 *
 * The rules (clear space, where the accent may go) are on the design-language page under
 * "Brand".
 */
export const Wordmark = forwardRef<HTMLSpanElement, WordmarkProps>(
  ({ size = 'md', decorative = false, className, ...props }, ref) => (
    <span
      ref={ref}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Lupin' })}
      className={cn(
        'inline-flex shrink-0 items-baseline font-semibold tracking-tight text-fg',
        SIZE[size],
        className,
      )}
      {...props}
    >
      <span>Lupin</span>
      <span data-wordmark-dot className="text-accent">
        .
      </span>
    </span>
  ),
);
Wordmark.displayName = 'Wordmark';
