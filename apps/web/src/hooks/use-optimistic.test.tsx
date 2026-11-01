import { act, renderHook } from '@testing-library/react';
import { useOptimisticList } from './use-optimistic.js';

interface Row {
  id: string;
  name: string;
}

/**
 * An optimistic add: the row is on screen the moment the person submits, marked as unsaved,
 * and the server's answer either confirms it (replaced by the real row) or takes it away
 * again. A rollback that left the guess on screen would be the worst outcome — the list would
 * say something the server refused — so that direction is asserted as hard as the happy one.
 */
describe('useOptimisticList', () => {
  function setup(initial: Row[] = []) {
    return renderHook(() => useOptimisticList<Row>(initial));
  }

  it('shows the guess immediately, marked pending, before the server answers', async () => {
    const { result } = setup([{ id: 'a', name: 'kept' }]);
    let resolve: (row: Row) => void = () => undefined;
    const commit = new Promise<Row>((done) => (resolve = done));
    let settled: Promise<Row> | undefined;
    act(() => {
      settled = result.current.add({ id: 'temp', name: 'new' }, () => commit);
    });
    expect(result.current.items.map((row) => row.name)).toEqual(['kept', 'new']);
    expect(result.current.isPending('temp')).toBe(true);
    await act(async () => {
      resolve({ id: 'real', name: 'new' });
      await settled;
    });
    expect(result.current.items).toEqual([
      { id: 'a', name: 'kept' },
      { id: 'real', name: 'new' },
    ]);
    expect(result.current.isPending('temp')).toBe(false);
    expect(result.current.isPending('real')).toBe(false);
  });

  it('takes the guess away and rethrows when the server refuses', async () => {
    const { result } = setup([{ id: 'a', name: 'kept' }]);
    let caught: unknown;
    await act(async () => {
      await result.current
        .add({ id: 'temp', name: 'refused' }, () => Promise.reject(new Error('no')))
        .catch((error: unknown) => (caught = error));
    });
    expect((caught as Error).message).toBe('no');
    expect(result.current.items).toEqual([{ id: 'a', name: 'kept' }]);
    expect(result.current.isPending('temp')).toBe(false);
  });

  it('replaces the list when the source data changes, as after a reload', () => {
    const { result } = setup();
    act(() => result.current.reset([{ id: 'b', name: 'loaded' }]));
    expect(result.current.items).toEqual([{ id: 'b', name: 'loaded' }]);
  });
});
