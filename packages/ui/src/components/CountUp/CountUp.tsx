import { useRef, type CSSProperties, type ReactElement } from 'react';
import { cn } from '../../lib/utils.js';

/** The largest integer a CSS `<integer>` property is asked to hold here. */
const MAX_COUNTED = 999_999_999;

export interface CountUpProps {
  /**
   * The figure. Only a non-negative whole number counts; anything else (a percentage, a
   * decimal, a duration, text) is drawn as the string it already is.
   */
  value: number | string;
  className?: string;
}

/** Whether `value` is something a CSS counter can print as itself. */
export function isCountable(value: number | string): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNTED;
}

/**
 * A figure that counts to its value when it changes. The animation is `count-up` in
 * `motion.css`, which is CSS only: no timer and no state update per frame.
 *
 * The real number is rendered once, visually hidden, and the animated copy is `aria-hidden`,
 * because generated content is not reliably read by assistive technology and cannot be
 * selected. The reader has the value from the first paint; the count is for the eye.
 *
 * The `key` is the value, so a changed figure remounts its animated half and the animation
 * runs again, from the value it had (`--count-from`) rather than from zero. The first render
 * counts up from zero, which is the arrival of a number that was not there.
 */
export function CountUp({ value, className }: CountUpProps): ReactElement {
  const previous = useRef<number | null>(null);
  if (!isCountable(value)) {
    previous.current = null;
    return <span className={className}>{value}</span>;
  }
  const from = previous.current ?? 0;
  previous.current = value;
  const style = { '--count-from': from, '--count-to': value } as CSSProperties;
  return (
    <span className={cn('inline-block tabular-nums', className)}>
      <span className="sr-only">{value}</span>
      <span key={value} aria-hidden="true" className="count-up" style={style} />
    </span>
  );
}
