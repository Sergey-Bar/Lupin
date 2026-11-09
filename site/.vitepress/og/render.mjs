// Renders og-image.html to site/public/og-image.png with the repository's Playwright.
// Run from the repository root: node site/.vitepress/og/render.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('@playwright/test');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(pathToFileURL(path.join(here, 'og-image.html')).href);
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(root, 'site/public/og-image.png');
  await page.screenshot({ path: out });
  console.log(`wrote ${path.relative(root, out)}`);
} finally {
  await browser.close();
}
