import { runTransitionName } from './view-transition.js';

/**
 * The shared-element name a run carries in the list and on its detail page.
 *
 * The browser morphs two elements across a navigation only when both carry the same
 * `view-transition-name`, the name is a valid CSS identifier, and no other element on the
 * page carries it. So the name is derived in one place from the run id, and both screens
 * ask for it rather than spelling it.
 */
describe('runTransitionName', () => {
  it('derives one name per run, the same on both screens', () => {
    expect(runTransitionName('8f14e45f-ea9b-4b2c-9d1e-1c2b3a4d5e6f')).toBe(
      runTransitionName('8f14e45f-ea9b-4b2c-9d1e-1c2b3a4d5e6f'),
    );
    expect(runTransitionName('run-a')).not.toBe(runTransitionName('run-b'));
  });

  it('is a valid identifier even when the id starts with a digit or carries punctuation', () => {
    for (const id of ['8f14e45f-ea9b', 'run 42', 'a/b:c.d', '']) {
      expect(runTransitionName(id)).toMatch(/^run-[A-Za-z0-9_-]*$/);
    }
  });

  it('keeps two ids that differ only in punctuation apart', () => {
    expect(runTransitionName('a/b')).not.toBe(runTransitionName('a:b'));
  });
});
