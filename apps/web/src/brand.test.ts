import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The app and the site wear one mark.
 *
 * The favicon is committed twice — once in each `public/` directory, because Vite and
 * VitePress each copy only their own — so the two copies are held byte-identical here
 * rather than trusted to stay so. A tab of the console and a tab of the docs should not be
 * two different violet squares.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

describe('the brand mark', () => {
  it('ships the same favicon as the site, byte for byte', () => {
    const app = readFileSync(path.join(repoRoot, 'apps/web/public/favicon.svg'));
    const site = readFileSync(path.join(repoRoot, 'site/public/favicon.svg'));
    expect(app.equals(site)).toBe(true);
  });

  it('links the favicon and names the tab Lupin', () => {
    const html = readFileSync(path.join(repoRoot, 'apps/web/index.html'), 'utf8');
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/);
    expect(html).toMatch(/<title>Lupin<\/title>/);
  });
});
