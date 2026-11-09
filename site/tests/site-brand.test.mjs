import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import test from 'node:test';

const site = fileURLToPath(new URL('../../site/', import.meta.url));
const read = (relative) => readFileSync(`${site}${relative}`, 'utf8');
const config = read('.vitepress/config.mts');

test('a shared link carries a title, a description and a preview image', () => {
  for (const property of ['og:title', 'og:description', 'og:image', 'og:type']) {
    assert.match(config, new RegExp(`property: '${property}'`), property);
  }
  assert.match(config, /name: 'twitter:card', content: 'summary_large_image'/);
});

test('the preview image exists and is resolved against the deploy base', () => {
  assert.ok(existsSync(`${site}public/og-image.png`), 'site/public/og-image.png');
  // A project page lives under /<repo>/, and a crawler does not resolve a relative URL.
  assert.match(config, /og-image\.png/);
  assert.match(config, /SITE_URL/);
});

test('the nav draws the wordmark the product draws: the name, then a full stop in the accent', () => {
  const layout = read('.vitepress/theme/Layout.vue');
  assert.match(layout, /#nav-bar-title-after/);
  assert.match(layout, /class="lupin-wordmark-dot"/);
  const css = read('.vitepress/theme/lupin.css');
  assert.match(css, /\.lupin-wordmark-dot\s*\{[^}]*color:\s*var\(--site-accent\)/s);
});

test('the nav title is set once, in sentence case at the brand tracking', () => {
  const custom = read('.vitepress/theme/custom.css');
  assert.doesNotMatch(custom, /\.VPNavBarTitle \.title/, 'custom.css must not restyle the title');
  const css = read('.vitepress/theme/lupin.css');
  assert.match(css, /\.VPNavBarTitle \.title\s*\{[^}]*letter-spacing:\s*-0\.02em/s);
  assert.doesNotMatch(css, /\.VPNavBarTitle \.title\s*\{[^}]*uppercase/s);
});
