/**
 * Motion tokens, and the scale that turns them off.
 *
 * `motion.duration` has always been a set of numbers nothing consumed at
 * runtime, and `prefers-reduced-motion` appeared nowhere in the repository, so a
 * user who asked their operating system to stop moving things still got a drawer
 * sliding in, a palette fading up and a `Loader2` spinning forever. A vestibular
 * disorder is not a preference the product gets to ignore.
 *
 * The mechanism is one multiplier rather than a second copy of the scale:
 * `motion.css` defines every duration as `calc(<value> * var(--lupin-motion-scale))`
 * and the reduced-motion media query sets that one variable. So the reduced
 * rule is a single declaration that reaches every duration *and every duration
 * added later*, with no list here to fall out of date. `motion.test.ts` asserts
 * that link in both directions.
 */

export const motion = {
  duration: {
    75: '75ms',
    100: '100ms',
    150: '150ms',
    200: '200ms',
    300: '300ms',
  },
  easing: {
    linear: 'linear',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
    /**
     * A damped spring (damping ratio 0.78) sampled into 17 stops: it overshoots by 2% and
     * settles. `linear()` is interpolated by the browser like any other easing, so it costs
     * nothing per frame on the main thread. For arrivals only — an exit never bounces.
     */
    spring:
      'linear(0, 0.102, 0.309, 0.526, 0.708, 0.842, 0.93, 0.982, 1.008, 1.018, 1.02, 1.017, 1.012, 1.008, 1.005, 1.003, 1)',
  },
};

/** The custom property every duration is multiplied by. `1` is "no scaling". */
export const MOTION_SCALE_VARIABLE = '--lupin-motion-scale';

/**
 * The multiplier applied under `prefers-reduced-motion: reduce`.
 *
 * `0.01` rather than `0`, deliberately: a transition or animation of exactly
 * zero is treated by some engines as "do not start this at all", and then the
 * `transitionend` / `animationend` handler that was supposed to run on
 * completion never runs. `0.01ms` finishes instantly and still fires.
 */
export const REDUCED_MOTION_SCALE = 0.01;

/** The duration, in ms, that reduced motion collapses animations to. */
export const REDUCED_MOTION_DURATION = `${REDUCED_MOTION_SCALE}ms`;

/** The custom property a duration step is published under. */
export function durationVariableName(step: number): string {
  return `--lupin-duration-${step}`;
}

/** The custom property an easing step is published under. */
export function easingVariableName(step: string): string {
  return `--lupin-ease-${step}`;
}

/**
 * Every duration step, as CSS declarations in terms of the scale.
 *
 * Exported rather than kept private so `motion.test.ts` can assert the shipped
 * stylesheet is exactly this — a test that recomputes the same string in a
 * different way proves nothing, and this is the string that has to be right.
 */
export function motionDurationDeclarations(scaleVariable = MOTION_SCALE_VARIABLE): string {
  return Object.entries(motion.duration)
    .map(
      ([step, value]) =>
        `  ${durationVariableName(Number(step))}: calc(${value} * var(${scaleVariable}));`,
    )
    .join('\n');
}

/**
 * Every easing step, as the CSS declaration that publishes it.
 *
 * The easings had no published form before the enter/exit animations needed
 * one — `--animate-*` has to name a timing function, and hard-coding
 * `cubic-bezier(0, 0, 0.2, 1)` into the animation shorthand would have been a
 * second copy of the value this table already owns. Same shape as
 * `motionDurationDeclarations`, and asserted in both directions by
 * `motion.test.ts` for the same reason.
 */
export function motionEasingDeclarations(): string {
  return Object.entries(motion.easing)
    .map(([step, value]) => `  ${easingVariableName(step)}: ${value};`)
    .join('\n');
}
