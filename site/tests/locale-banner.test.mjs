import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { translations } from '../../site/.vitepress/locales.ts';

const home = readFileSync(
  new URL('../.vitepress/theme/LocalizedHome.vue', import.meta.url),
  'utf8',
);

test('every non-English locale says, in its own language, that the docs are in English', () => {
  for (const copy of translations.filter((item) => item.code !== 'en')) {
    assert.ok(copy.note.trim().length > 0, copy.code);
    assert.notEqual(copy.note, translations.find((item) => item.code === 'en')?.note, copy.code);
  }
});

test('the notice is a banner at the top of the page that links to the English site', () => {
  const template = home.slice(home.indexOf('<template>'));
  const banner = template.indexOf('class="localized-home__banner"');
  assert.ok(banner > 0, 'banner element');
  assert.ok(banner < template.indexOf('<h1'), 'banner comes before the heading');
  assert.match(template, /role="note"/u);
  assert.match(
    template,
    /:href="withBase\('\/'\)"[^>]*lang="en"|lang="en"[^>]*:href="withBase\('\/'\)"/su,
  );
});

test('the wordmark stays "Lupin." in a right-to-left locale, not ".Lupin"', () => {
  assert.match(home, /class="localized-home__brand"[^>]*dir="ltr"/u);
  const css = readFileSync(new URL('../.vitepress/theme/lupin.css', import.meta.url), 'utf8');
  assert.match(css, /\.VPNavBarTitle \.title\s*\{[^}]*direction:\s*ltr/su);
});

test('the brand line is the wordmark, not spaced capitals', () => {
  assert.match(home, /localized-home__brand[^<]*>Lupin<span[^>]*>\.<\/span>/su);
  assert.doesNotMatch(home, /letter-spacing:\s*0\.25em/u);
});
