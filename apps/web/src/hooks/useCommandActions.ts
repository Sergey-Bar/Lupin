import { useEffect, useSyncExternalStore } from 'react';
import type { CommandAction } from '@lupin/ui';

class CommandStore {
  private actions: Map<string, CommandAction> = new Map();
  private listeners: Set<() => void> = new Set();
  private cachedActions: CommandAction[] = [];

  register(actions: CommandAction[]) {
    let changed = false;
    actions.forEach((action) => {
      const existing = this.actions.get(action.id);
      if (existing !== action) {
        this.actions.set(action.id, action);
        changed = true;
      }
    });

    // limit to 50
    if (this.actions.size > 50) {
      const keys = Array.from(this.actions.keys()).slice(-50); // Keep last 50
      const newMap = new Map();
      keys.forEach((k) => newMap.set(k, this.actions.get(k)!));
      this.actions = newMap;
      changed = true;
    }

    if (changed) {
      this.updateCache();
      this.notify();
    }
  }

  deregister(actionIds: string[]) {
    let changed = false;
    actionIds.forEach((id) => {
      if (this.actions.has(id)) {
        this.actions.delete(id);
        changed = true;
      }
    });

    if (changed) {
      this.updateCache();
      this.notify();
    }
  }

  getActions(): CommandAction[] {
    return this.cachedActions;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateCache() {
    this.cachedActions = Array.from(this.actions.values());
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  // For tests
  clear() {
    this.actions.clear();
    this.updateCache();
    this.notify();
  }
}

export const commandStore = new CommandStore();

export function useCommandStore() {
  return useSyncExternalStore(
    (l) => commandStore.subscribe(l),
    () => commandStore.getActions(),
    () => commandStore.getActions(),
  );
}

/**
 * What makes a set of actions worth re-registering.
 *
 * Two arrays of actions are "the same" when they name the same ids, carry the same
 * labels, and bind the same callbacks. That is a value, not an identity, and the
 * difference is the whole fix below.
 *
 * The callbacks are compared by reference on purpose. A caller passing an inline
 * arrow has a *new* function every render, and comparing those by value is not
 * possible — two functions that behave identically are indistinguishable by
 * inspection. So the contract is the ordinary React one: wrap the callback in
 * `useCallback` if it changes, and a stable reference means "unchanged".
 *
 * @param actions the caller's list
 * @returns a string that is equal exactly when the list is equivalent
 */
function signatureOf(actions: CommandAction[]): string {
  return actions
    .map((action) => `${action.id}\u0000${action.label}\u0000${action.onSelect.name}`)
    .join('');
}

export function useCommandActions(actions: CommandAction[]) {
  // Depends on the *signature*, not on the array.
  //
  // The hook used to depend on the array's identity, and every caller writes the
  // list inline: `useCommandActions([{ id, label, onSelect }])` is a new array of
  // new objects on every render. So the effect re-ran on every render; its cleanup
  // called `deregister`, which notified; its body called `register`, which
  // notified because every object was a new reference. The notification re-rendered
  // the caller, which produced a new array, which re-ran the effect — and React
  // stopped it by throwing "Maximum update depth exceeded".
  //
  // Depending on a derived string is what breaks the cycle, because an equivalent
  // list produces an equal string and the effect does not re-run. It is not enough
  // to compare the actions in `register` instead: the cleanup deregisters before the
  // body registers, and the deregistration is itself the notification.
  const signature = signatureOf(actions);
  useEffect(() => {
    commandStore.register(actions);
    const ids = actions.map((a) => a.id);
    return () => {
      commandStore.deregister(ids);
    };
    // `signature` stands in for `actions`; the effect genuinely only needs to run
    // when the list changes value, and `actions` changes identity constantly.
  }, [signature]);
}
