import React from 'react';

/** How far the wheel must turn before it counts as one step: one notch on a mouse is ~100. */
const THRESHOLD = 50;
/** After a step the wheel is ignored this long, so one flick of a trackpad moves one place. */
const LOCK_MS = 400;

/**
 * Turning the wheel over a list of places moves to the next or previous one.
 *
 * One step per gesture, never a run of them, and never past either end, so a reader always
 * knows where they will land. Down and right go forward; up and left go back.
 */
export function useWheelStep(
  paths: readonly string[],
  current: number,
  go: (path: string) => void,
): (event: React.WheelEvent) => void {
  const travelled = React.useRef(0);
  const lockedUntil = React.useRef(0);
  return (event) => {
    if (event.ctrlKey || current < 0) return;
    const now = Date.now();
    if (now < lockedUntil.current) return;
    travelled.current +=
      Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(travelled.current) < THRESHOLD) return;
    const next = current + (travelled.current > 0 ? 1 : -1);
    travelled.current = 0;
    const target = paths[next];
    if (target === undefined) return;
    lockedUntil.current = now + LOCK_MS;
    go(target);
  };
}
