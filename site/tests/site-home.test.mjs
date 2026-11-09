import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (name) =>
  readFileSync(new URL(`../.vitepress/theme/${name}`, import.meta.url), 'utf8');
const home = read('Home.vue');
const template = home.slice(home.indexOf('<template>'));
const css = read('lupin.css');

test('the sections the nav links to exist, plus the quick start', () => {
  for (const id of ['product', 'how-it-works', 'get-started']) {
    assert.match(template, new RegExp(`id="${id}"`, 'u'), id);
  }
});

test('every image has a written description', () => {
  const images = [...template.matchAll(/<img\b[^>]*>/gsu)].map((match) => match[0]);
  assert.ok(images.length >= 1);
  for (const image of images) assert.match(image, /\balt="[^"]{20,}"/u, image);
});

test('the hero shows a release decision a reader can read, not a decoration', () => {
  assert.match(template, /class="lupin-decision\b[^"]*"[^>]*aria-label="[^"]+"/su);
  // Colour is never the only carrier: each row's verdict is a word.
  for (const word of ['Blocked', 'Failed', 'Quarantined', 'Passed', 'Not configured']) {
    assert.match(home, new RegExp(word, 'u'), word);
  }
});

test('the quick start is three steps with the real commands from the guides', () => {
  assert.match(template.slice(template.indexOf('id="get-started"')), /quickStart/u);
  assert.match(home, /command: '\.\/start\.sh'/u);
  assert.match(home, /lupin test --format playwright-json/u);
  assert.match(home, /lupin gate --branch/u);
  assert.equal((home.match(/\bcommand:/gu) ?? []).length, 3);
});

test('the showcase does not repeat the capability list', () => {
  assert.doesNotMatch(template, /lupin-showcase-notes/u);
});

test('home motion is token-timed arrival only, and stops under reduced motion', () => {
  const homeCss = css.slice(
    css.indexOf('/* home: motion */'),
    css.indexOf('/* home: motion end */'),
  );
  assert.ok(homeCss.length > 0, 'motion block is marked');
  assert.match(
    homeCss,
    /animation:\s*lupin-enter var\(--lupin-duration-150\) var\(--lupin-ease-arrive\)/u,
  );
  assert.doesNotMatch(homeCss, /\d+m?s\b(?![^(]*\))/u, 'no literal duration');
  assert.match(homeCss, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.doesNotMatch(css, /backdrop-filter/u);
});
