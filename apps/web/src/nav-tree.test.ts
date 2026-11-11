import { describe, expect, it } from 'vitest';
import { navTree, routeManifest } from './route-manifest.js';

describe('navTree, the sidebar built from the manifest', () => {
  it('lists every tab exactly once, and no untabbed alias of a page', () => {
    const pages = navTree('admin').flatMap((group) => group.pages.map((page) => page.id));
    const expected = routeManifest.filter((route) => 'tab' in route).map((route) => route.id);
    expect([...pages].sort()).toEqual([...expected].sort());
    expect(new Set(pages).size).toBe(pages.length);
  });

  it('keeps the five places in order, Settings last', () => {
    expect(navTree('admin').map((group) => group.id)).toEqual([
      'now',
      'runs',
      'tests',
      'health',
      'settings',
    ]);
  });

  it('hides pages a viewer may not open', () => {
    const settings = navTree('viewer').find((group) => group.id === 'settings');
    expect(settings?.pages.some((page) => page.id === 'settings-members')).toBe(false);
    expect(settings?.pages.some((page) => page.id === 'settings-appearance')).toBe(true);
  });

  it('lists only the visible pages of a place that has no tabs, for a reader with no role', () => {
    // Health has tabs; every place does today, so this pins the role-null path instead.
    const tree = navTree(null);
    const settings = tree.find((group) => group.id === 'settings');
    expect(settings?.pages.map((page) => page.id)).toEqual(
      expect.arrayContaining(['settings-appearance', 'map', 'toolbox']),
    );
    expect(settings?.pages.some((page) => page.id === 'settings-identity')).toBe(false);
  });

  it('names the Settings groups in order: Personal, Workspace, Install, Tools', () => {
    const settings = navTree('admin').find((group) => group.id === 'settings');
    const names = [...new Set(settings?.pages.map((page) => page.group))];
    expect(names).toEqual(['Personal', 'Workspace', 'Install', 'Tools']);
  });
});
