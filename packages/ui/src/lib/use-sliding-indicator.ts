import { useLayoutEffect, useRef, type RefObject } from 'react';

/** The attribute that marks the item the indicator sits under. */
export const INDICATOR_ACTIVE_ATTRIBUTE = 'data-indicator-active';

/**
 * Place the `indicator` utility (`motion.css`) under whichever child is active.
 *
 * Attach the returned ref to the positioned (`relative`) container, render
 * `<span aria-hidden="true" className="indicator" />` inside it, and set
 * `data-indicator-active="true"` on the active child. The hook measures that child and writes
 * `--indicator-x` and `--indicator-w` on the container; the stylesheet animates the move.
 *
 * It measures again when the container resizes, because a font that finishes loading or a
 * window that narrows moves every item without any state changing, and an indicator left at
 * its old offset under a re-flowed row looks broken rather than slow.
 *
 * With no active child the width is set to 0, so the mark collapses rather than staying under
 * an item that is no longer selected.
 *
 * @param active any value that changes when the active item does
 */
export function useSlidingIndicator<T extends HTMLElement = HTMLElement>(
  active: unknown,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const container = ref.current;
    if (container === null) return undefined;

    const place = (): void => {
      const item = container.querySelector<HTMLElement>(`[${INDICATOR_ACTIVE_ATTRIBUTE}="true"]`);
      container.style.setProperty('--indicator-x', String(item?.offsetLeft ?? 0));
      container.style.setProperty('--indicator-w', String(item?.offsetWidth ?? 0));
    };
    place();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(place);
    observer.observe(container);
    return () => observer.disconnect();
  }, [active]);

  return ref;
}
