import { forwardRef, type InputHTMLAttributes } from 'react';
import { Check, Minus } from '../../icons.js';
import { cn } from '../../lib/utils.js';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> {
  /**
   * Some, but not all, of a group are selected. Drawn as a dash and exposed as `mixed` to
   * assistive technology; the underlying input is still a plain checkbox, so a click still
   * toggles `checked` and nothing about form submission changes.
   */
  indeterminate?: boolean;
}

/**
 * A checkbox drawn by the design system around a real `<input type="checkbox">`.
 *
 * The input is the control: it keeps the native role, name, keyboard behaviour, form
 * participation and mirroring in a right-to-left page. It is made invisible and stretched over
 * a hit area larger than the box (40px against a 20px box), and a sibling draws the box from the
 * input's own state through `peer-*` variants, so there is no second source of truth for
 * "checked" to drift from.
 *
 * Press feedback is the shared `scale-press` token, so reduced motion stops it. The check
 * itself fades in on the 100 ms hover/colour duration and does not move.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate = false, disabled, ...props }, ref) => (
    <span
      className={cn('relative inline-flex h-5 w-5 shrink-0 items-center justify-center', className)}
    >
      <input
        ref={(node) => {
          if (node !== null) node.indeterminate = indeterminate;
          if (typeof ref === 'function') ref(node);
          else if (ref !== null) ref.current = node;
        }}
        type="checkbox"
        disabled={disabled}
        className="peer absolute -inset-2.5 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none flex h-5 w-5 items-center justify-center rounded-sm border border-border-strong bg-surface text-on-fill',
          'transition-colors duration-100 motion-reduce:transition-none',
          'peer-hover:border-fg-muted peer-active:scale-press',
          'peer-checked:border-primary peer-checked:bg-primary',
          'peer-indeterminate:border-primary peer-indeterminate:bg-primary',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-border-focus',
          'peer-disabled:opacity-50',
          '[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100 peer-indeterminate:[&>svg]:opacity-100',
          '[&>svg]:transition-opacity [&>svg]:duration-100 motion-reduce:[&>svg]:transition-none',
        )}
      >
        {indeterminate ? <Minus size={14} strokeWidth={3} /> : <Check size={14} strokeWidth={3} />}
      </span>
    </span>
  ),
);
Checkbox.displayName = 'Checkbox';
