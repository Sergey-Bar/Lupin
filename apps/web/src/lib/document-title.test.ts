import { documentTitleFor } from './document-title.js';
import { routeManifest } from '../route-manifest.js';

describe('documentTitleFor', () => {
  it('names the page first and the product second, so a row of tabs reads by page', () => {
    const now = routeManifest.find((route) => route.path === '/dashboard/now');
    expect(now).toBeDefined();
    expect(documentTitleFor('/dashboard/now')).toBe(`${now?.label ?? ''} · Lupin`);
  });

  it('is the product name alone for a path the manifest does not know', () => {
    expect(documentTitleFor('/nowhere')).toBe('Lupin');
  });

  it('gives every manifest route a distinct page part', () => {
    for (const route of routeManifest) {
      if (route.path.includes('$')) continue;
      expect(documentTitleFor(route.path)).toMatch(/^.+ · Lupin$/);
    }
  });
});
