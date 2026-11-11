import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  /*
   * `primary` is the one solid fill on a screen: the Lupin violet with the on-fill label.
   * Every other variant is an edge or text. Hover changes the fill a step rather than
   * filtering it, `active:scale-press` is the press, and a loading button is `aria-busy`
   * and disabled, keeping its label so a screen reader still says what it is doing.
   */
  'inline-flex items-center justify-center rounded-md font-medium transition-[color,background-color,border-color,opacity,transform] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:scale-press',
  {
    variants: {
      variant: {
        primary: 'text-on-fill bg-primary-gradient shadow-elevation-1 hover:opacity-90',
        default: 'text-on-fill bg-primary-gradient shadow-elevation-1 hover:opacity-90',
        secondary: 'border border-border-strong bg-transparent text-fg hover:bg-surface-muted',
        destructive: 'text-on-fill bg-error hover:opacity-90',
        outline: 'border border-border-strong bg-transparent text-fg hover:bg-surface-muted',
        ghost: 'bg-transparent text-fg-muted hover:bg-surface-muted hover:text-fg',
        link: 'bg-transparent text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg',
      },
      size: {
        sm: 'h-8 px-3 text-xs gap-1.5',
        md: 'h-11 px-4 text-sm gap-2',
        lg: 'h-12 px-6 text-sm gap-2.5',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export { buttonVariants };

type ButtonVariants = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariants {
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  'data-testid'?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading,
      icon,
      iconRight,
      children,
      className = '',
      disabled,
      style,
      'data-testid': testId,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    // A disabled fill is not a dimmer fill: it reads as broken. It steps down to a quiet
    // outline instead. A busy button keeps its fill, so its progress reads as the same button.
    const filled = variant === 'primary' || variant === 'default' || variant === 'destructive';
    const quiet = disabled === true && filled;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={loading ? true : undefined}
        data-testid={testId}
        className={cn(
          quiet
            ? cn(
                buttonVariants({ variant: 'outline', size }),
                'border-border text-fg-muted hover:bg-transparent active:scale-100 cursor-not-allowed',
              )
            : buttonVariants({ variant, size }),
          !quiet && (isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'),
          className,
        )}
        style={style}
        {...rest}
      >
        {loading ? (
          <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin shrink-0" />
        ) : (
          icon && <span className="shrink-0">{icon}</span>
        )}
        {children}
        {iconRight && <span className="shrink-0">{iconRight}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement>, ButtonVariants {
  href: string;
  icon?: ReactNode;
}

/**
 * A link that is drawn as a button: the same variants, height, radius and hover, so a screen
 * never mixes a real button with a hand-styled look-alike. It navigates, so it stays an `<a>`
 * (a reader can open it in a new tab); `apps/web/src/button-rule.test.ts` refuses the
 * hand-written `bg-primary … text-on-fill` string this replaces.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ variant = 'primary', size = 'md', icon, children, className, ...rest }, ref) => (
    <a
      ref={ref}
      className={cn(buttonVariants({ variant, size }), 'cursor-pointer', className)}
      {...rest}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </a>
  ),
);

ButtonLink.displayName = 'ButtonLink';
