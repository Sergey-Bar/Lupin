import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_HOME_KEY,
  SCOPE_EVENT,
  SCOPE_KEY,
  isScopedPage,
  readScope,
  resolveScope,
  scopeSearch,
  writeScope,
} from './scope.js';

afterEach(() => {
  localStorage.clear();
});

describe('the scope a page reads', () => {
  it('is the one the address names, over the one remembered', () => {
    writeScope('p-saved');
    expect(resolveScope('p-link')).toBe('p-link');
  });

  it('is the one this browser last chose, when the address names none', () => {
    writeScope('p-saved');
    expect(resolveScope(undefined)).toBe('p-saved');
  });

  it('is every project when nothing was chosen, and after choosing every project', () => {
    expect(resolveScope(undefined)).toBeUndefined();
    writeScope('p-saved');
    writeScope(undefined);
    expect(resolveScope(undefined)).toBeUndefined();
    expect(localStorage.getItem(SCOPE_KEY)).toBeNull();
  });

  it('ignores a stored value or an address that is not an id', () => {
    localStorage.setItem(SCOPE_KEY, 'x'.repeat(500));
    expect(readScope()).toBeUndefined();
    expect(resolveScope('<script>')).toBeUndefined();
  });

  it('keeps the project Home used to remember, once, under the one key', () => {
    localStorage.setItem(LEGACY_HOME_KEY, 'p-home');
    expect(readScope()).toBe('p-home');
    expect(localStorage.getItem(SCOPE_KEY)).toBe('p-home');
    expect(localStorage.getItem(LEGACY_HOME_KEY)).toBeNull();
  });

  it('tells every listener in the page when the choice changes', () => {
    const heard = vi.fn();
    window.addEventListener(SCOPE_EVENT, heard);
    writeScope('p-2');
    writeScope('p-2');
    window.removeEventListener(SCOPE_EVENT, heard);
    // Writing the same choice twice is one change, not two.
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('which pages carry the scope', () => {
  it('is the pages that read ?project=, and never a page with its project in the path', () => {
    for (const id of ['now', 'prs', 'issues', 'briefing', 'delivery', 'ai-code', 'agents']) {
      expect(isScopedPage(id), id).toBe(true);
    }
    for (const id of ['runs', 'pr-risk', 'repo-360', 'portfolio', undefined]) {
      expect(isScopedPage(id), String(id)).toBe(false);
    }
  });

  it('adds ?project= to a scoped page only, and nothing for every project', () => {
    expect(scopeSearch('prs', 'p-1')).toEqual({ project: 'p-1' });
    expect(scopeSearch('prs', undefined)).toEqual({});
    expect(scopeSearch('runs', 'p-1')).toEqual({});
  });
});
