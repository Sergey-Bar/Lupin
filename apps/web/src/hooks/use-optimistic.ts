import { useCallback, useRef, useState } from 'react';

/**
 * A list that shows an addition before the server has confirmed it.
 *
 * `add(guess, commit)` puts `guess` on screen at once and remembers it as pending; when
 * `commit` resolves the guess is replaced by the server's row, and when it rejects the guess
 * is removed and the error is rethrown so the caller can say what went wrong. `isPending`
 * lets a row be drawn as unsaved while it is in flight.
 *
 * Deliberately not React 19's `useOptimistic`: that hook's optimistic state lives only for
 * the duration of a transition, and these lists are also written by loads and live updates,
 * so the guess has to be an ordinary entry that a load can replace (`reset`).
 */
export function useOptimisticList<T extends { id: string }>(initial: T[]) {
  const [items, setItems] = useState<T[]>(initial);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const mark = useCallback((id: string, on: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const add = useCallback(
    async (guess: T, commit: () => Promise<T>): Promise<T> => {
      setItems((current) => [...current, guess]);
      mark(guess.id, true);
      try {
        const confirmed = await commit();
        setItems((current) => current.map((item) => (item.id === guess.id ? confirmed : item)));
        return confirmed;
      } catch (error) {
        setItems((current) => current.filter((item) => item.id !== guess.id));
        throw error;
      } finally {
        mark(guess.id, false);
      }
    },
    [mark],
  );

  const reset = useCallback((next: T[]) => setItems(next), []);
  const isPending = useCallback((id: string) => pending.has(id), [pending]);

  return { items, add, reset, isPending };
}
