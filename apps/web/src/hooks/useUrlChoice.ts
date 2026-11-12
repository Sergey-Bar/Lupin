import { useCallback, useState } from 'react';

/**
 * A choice that lives in the URL, so a shared or reloaded link opens on the same view.
 *
 * Only an offered value is read: the URL is input from anyone with the link, so a value the
 * page does not offer falls back to the default. Writing uses `replaceState`, keeping every
 * other parameter, so switching a window adds no history entry for Back to wade through.
 */
export function useUrlChoice<T extends string>(
  key: string,
  options: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const read = (): T => {
    const value = new URLSearchParams(window.location.search).get(key);
    return options.find((option) => option === value) ?? fallback;
  };
  const [value, setValue] = useState<T>(read);
  const set = useCallback(
    (next: T) => {
      const url = new URL(window.location.href);
      url.searchParams.set(key, next);
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
      setValue(next);
    },
    [key],
  );
  return [value, set];
}
