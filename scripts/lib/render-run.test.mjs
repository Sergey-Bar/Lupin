import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RENDER_SERVE_ENV, renderEnvironment } from './render-run.mjs';

test('the measured bundle is a production build, whatever the developer environment says', () => {
  // A developer's `.env` sets NODE_ENV=development, and Vite applies it to `vite build`, so on
  // the reference install the budget measured React's development build: 1.5 MB of entry
  // against 1.1 MB, and a long task on every route the shipped bundle does not have.
  const env = renderEnvironment({ NODE_ENV: 'development', PATH: '/bin' });
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.PATH, '/bin');
});

test('the run serves the built bundle, and a caller cannot turn that off', () => {
  const env = renderEnvironment({}, { [RENDER_SERVE_ENV]: 'dev', LUPIN_RENDER_WRITE: '1' });
  assert.equal(env[RENDER_SERVE_ENV], 'preview');
  assert.equal(env.LUPIN_RENDER_WRITE, '1');
});

test('a caller cannot measure a development bundle by passing one in', () => {
  assert.equal(renderEnvironment({}, { NODE_ENV: 'development' }).NODE_ENV, 'production');
});
