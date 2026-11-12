import { statusWord } from './status-word.js';

describe('statusWord', () => {
  it.each([
    ['failed', 'Failed'],
    ['PASSED', 'Passed'],
    ['not_configured', 'Not configured'],
    ['gate-evaluation', 'Gate evaluation'],
    ['UNKNOWN', 'Unknown'],
  ])('reads %s as %s, in sentence case like every other label', (raw, word) => {
    expect(statusWord(raw)).toBe(word);
  });

  it('says Pending for a status that has not arrived', () => {
    expect(statusWord(undefined)).toBe('Pending');
    expect(statusWord(null)).toBe('Pending');
    expect(statusWord('')).toBe('Pending');
  });
});
