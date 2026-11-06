import React from 'react';
import { SECTIONS, type SectionId } from '../route-manifest.js';

/** The wheel distance, in px, that counts as a deliberate step rather than a trackpad tremor. */
export const WHEEL_THRESHOLD = 40;

/** After a step, how long further wheel events are ignored, so one flick moves one category. */
export const WHEEL_COOLDOWN_MS = 700;

/** The section path one step away in rail order, or null at either end. */
export function adjacentSection(current: SectionId | null, direction: 1 | -1): string | null {
  if (current === null) return null;
  const index = SECTIONS.findIndex((section) => section.id === current);
  return SECTIONS[index + direction]?.path ?? null;
}

/** Whether an element between `target` and `frame` can still scroll in `direction`. */
function innerCanScroll(target: Element, frame: Element, direction: 1 | -1): boolean {
  for (let node: Element | null = target; node && node !== frame; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const el = node as HTMLElement;
    if (el.scrollHeight <= el.clientHeight) continue;
    const atEnd =
      direction === 1 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1 : el.scrollTop <= 0;
    if (!atEnd) return true;
  }
  return false;
}

/**
 * Snap between categories with the wheel, like a product page: each category is one screen,
 * and one wheel step at the edge of it moves to the next or previous one in rail order.
 *
 * A list or table that scrolls inside the page scrolls first; the step only happens once it is
 * at its end. A text field never moves the screen. A burst of wheel events (a trackpad flick
 * fires dozens) moves once, then waits `WHEEL_COOLDOWN_MS`. Navigation goes through the router,
 * so the move is the same view-transition crossfade as a click, and reduced motion still applies.
 */
export function useSectionWheel<T extends HTMLElement>(
  current: SectionId | null,
  go: (path: string) => void,
): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const until = React.useRef(0);
  const state = React.useRef({ current, go });
  state.current = { current, go };

  React.useEffect(() => {
    const frame = ref.current;
    if (frame === null) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) < WHEEL_THRESHOLD || event.ctrlKey) return;
      const target = event.target as Element | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) {
        return;
      }
      const direction = event.deltaY > 0 ? 1 : -1;
      if (target && innerCanScroll(target, frame, direction)) return;
      const now = Date.now();
      if (now < until.current) return;
      const path = adjacentSection(state.current.current, direction);
      if (path === null) return;
      until.current = now + WHEEL_COOLDOWN_MS;
      state.current.go(path);
    };
    frame.addEventListener('wheel', onWheel, { passive: true });
    return () => frame.removeEventListener('wheel', onWheel);
  }, []);

  return ref;
}
