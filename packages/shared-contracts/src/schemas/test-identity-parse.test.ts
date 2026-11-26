import { describe, expect, it } from 'vitest';
import { parseTestIdentity, playwrightTestListLine, testIdentity } from './test-identity.js';

describe('parseTestIdentity', () => {
  it('reads back the parts testIdentity wrote, project included', () => {
    expect(
      parseTestIdentity(
        testIdentity({
          file: 'e2e/cart.spec.ts',
          describePath: ['Cart', 'Coupons'],
          title: 'applies',
          project: 'webkit',
        }),
      ),
    ).toEqual({
      file: 'e2e/cart.spec.ts',
      describePath: ['Cart', 'Coupons'],
      title: 'applies',
      project: 'webkit',
    });
  });

  it('keeps a title that contains the separator or brackets as the title it was', () => {
    const tricky = { file: 'a.spec.ts', describePath: ['x › y'], title: 'b [c] {d}', project: '' };
    expect(parseTestIdentity(testIdentity(tricky))).toEqual(tricky);
  });

  it.each([
    [{ file: 'a.ts', describePath: [], title: 't', project: '' }],
    [{ file: 'a\\b.ts', describePath: ['\\'], title: '\\\\', project: '' }],
    [{ file: 'a.ts', describePath: ['[x]', '{y}'], title: 'ends in ]', project: 'p [q]' }],
    [{ file: 'a.ts', describePath: [' › '], title: '›', project: '›' }],
    [{ file: '', describePath: ['d'], title: 't', project: '' }],
  ])('round-trips %j', (parts) => {
    expect(parseTestIdentity(testIdentity(parts))).toEqual(parts);
  });

  it('refuses a value that is not an identity', () => {
    expect(parseTestIdentity('just-a-row-id')).toBeUndefined();
  });
});

describe('playwrightTestListLine', () => {
  it('writes the project first, then the title path, the way --test-list reads it', () => {
    expect(
      playwrightTestListLine(
        testIdentity({
          file: 'e2e/cart.spec.ts',
          describePath: ['Cart'],
          title: 'pays',
          project: 'chromium',
        }),
      ),
    ).toBe('[chromium] › e2e/cart.spec.ts › Cart › pays');
    expect(playwrightTestListLine(testIdentity({ file: 'a.spec.ts', title: 't' }))).toBe(
      'a.spec.ts › t',
    );
  });

  it('names nothing for an identity with no file, or for a row id', () => {
    expect(playwrightTestListLine(testIdentity({ file: null, title: 't' }))).toBeUndefined();
    expect(playwrightTestListLine('went-red')).toBeUndefined();
  });
});
