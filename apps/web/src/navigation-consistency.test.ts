import { describe, expect, it } from 'vitest';
import { GO_TO } from './components/Shortcuts.js';
import { paletteRoutes, QUESTIONS } from './components/GlobalCommandPalette.js';
import { legacySettingsPath } from './routes/__root.js';
import { navTree, routeFor } from './route-manifest.js';

/**
 * One page, one address, one name (ledger MNT-184). Five admin pages were routed twice, at
 * `/dashboard/<page>` and `/dashboard/settings/<page>`; the palette offered the old copies to
 * every role, a shortcut called Pull requests "Delivery", and "Can we ship?" opened Health
 * rather than Home's release verdict.
 */
const OLD = ['access', 'members', 'audit', 'deployment', 'reports'] as const;

describe('the five admin pages have one address', () => {
  it('sends each old address to its Settings page, keeping nothing else', () => {
    for (const page of OLD) {
      expect(legacySettingsPath(`/dashboard/${page}`), page).toBe(`/dashboard/settings/${page}`);
      expect(legacySettingsPath(`/dashboard/${page}/`), page).toBe(`/dashboard/settings/${page}`);
    }
    expect(legacySettingsPath('/dashboard/settings/access')).toBeNull();
    expect(legacySettingsPath('/dashboard/runs')).toBeNull();
  });
});

describe('the palette', () => {
  it('offers no page the caller cannot open, and no page twice', () => {
    const viewer = paletteRoutes('viewer').map((route) => route.path);
    for (const page of ['members', 'audit', 'deployment', 'access']) {
      expect(viewer).not.toContain(`/dashboard/${page}`);
      expect(viewer).not.toContain(`/dashboard/settings/${page}`);
    }
    const admin = paletteRoutes('admin').map((route) => route.path);
    expect(admin).toContain('/dashboard/settings/members');
    expect(admin).not.toContain('/dashboard/members');
    expect(new Set(admin).size).toBe(admin.length);
  });

  it('answers "can we ship" with Home, where the release verdict is', () => {
    expect(QUESTIONS.find((question) => question.id === 'ship')?.to).toBe('/dashboard/now');
  });
});

describe('the shortcuts', () => {
  it('go where their names say, and to the address the sidebar uses', () => {
    const sidebar = new Set(
      navTree('admin').flatMap((group) => [group.path, ...group.pages.map((page) => page.path)]),
    );
    for (const [key, target] of Object.entries(GO_TO)) {
      expect(routeFor(target.to), `g ${key}`).toBeDefined();
      expect(sidebar.has(target.to), `g ${key} -> ${target.to}`).toBe(true);
    }
    expect(GO_TO['d']).toEqual({ label: 'Delivery', to: '/dashboard/delivery' });
  });
});
