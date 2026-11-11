import { describe, expect, it } from 'vitest';
import { navTree, routeManifest } from './route-manifest.js';

describe('navTree, the sidebar built from the manifest', () => {
  it('lists every tab exactly once, plus the visible pages of a place with no tabs', () => {
    const pages = navTree('admin').flatMap((group) => group.pages.map((page) => page.id));
    const tabbed = new Set(
      routeManifest.filter((route) => 'tab' in route).map((route) => route.section),
    );
    const expected = routeManifest
      .filter((route) => ('tab' in route ? true : route.visible && !tabbed.has(route.section)))
      .map((route) => route.id);
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

  it('names the Settings groups in order: Personal, Workspace, Install, Tools', () => {
    const settings = navTree('admin').find((group) => group.id === 'settings');
    const names = [...new Set(settings?.pages.map((page) => page.group))];
    expect(names).toEqual(['Personal', 'Workspace', 'Install', 'Tools']);
  });
});
