import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

// The site's colours are the product's since 4.0.0 (`lupin.css` maps `--site-*` onto
// `--lupin-*`), so their contrast is measured once, in `packages/ui/src/tokens/theme.test.ts`,
// rather than a second time against a copy here.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^\uFEFF/, '');

test('self-hosted font files match their recorded provenance', () => {
  const manifest = JSON.parse(read('../public/fonts/manifest.json'));
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  assert.equal(manifest.fonts.length, 2);
  assert.match(read('../public/fonts/OFL.txt'), /SIL OPEN FONT LICENSE/i);
  for (const font of manifest.fonts) {
    const bytes = readFileSync(new URL(`../public/fonts/${font.file}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), font.sha256);
  }
});
