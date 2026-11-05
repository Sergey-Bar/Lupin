import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';
import type { HTMLAttributes } from 'react';

/**
 * A status is a dot and a word. The word is in the foreground; only the dot carries the
 * run-state colour, so a screen of runs reads as text with a few points of colour rather than
 * as a field of filled pills. The dot is never the only signal — the word is always there.
 */
const DOT = 'before:size-1.5 before:shrink-0 before:rounded-full';

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
  {
    variants: {
      variant: {
        default: `${DOT} text-fg before:bg-accent`,
        secondary: 'text-fg-muted',
        danger: `${DOT} text-fg before:bg-danger`,
        success: `${DOT} text-fg before:bg-success`,
        warning: `${DOT} text-fg before:bg-warning`,
        outline: 'text-fg-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
