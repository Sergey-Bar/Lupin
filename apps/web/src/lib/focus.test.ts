import { focusOf, greetingFor, focusSentence } from './focus.js';
import type { AttentionItem } from './attention.js';

const item = (id: string, at = '2026-11-09T08:00:00.000Z'): AttentionItem => ({
  id,
  severity: 'bad',
  title: id,
  detail: 'on main',
  action: { label: 'Open run', to: `/dashboard/runs/${id}` },
  at,
});

describe('focusOf', () => {
  it('puts exactly one thing first, two at most next, and only counts the rest', () => {
    const focus = focusOf([item('a'), item('b'), item('c'), item('d'), item('e')]);
    expect(focus.first?.id).toBe('a');
    expect(focus.next.map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(focus.hidden.map((entry) => entry.id)).toEqual(['d', 'e']);
  });

  it('has nothing first when nothing needs you', () => {
    expect(focusOf([])).toEqual({ first: undefined, next: [], hidden: [] });
  });
});

describe('greetingFor', () => {
  it.each([
    [5, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [17, 'Good afternoon'],
    [18, 'Good evening'],
    [23, 'Good evening'],
    [2, 'Working late'],
  ])('at %i:00 says %s', (hour, greeting) => {
    const at = new Date(2026, 10, 9, hour, 0, 0);
    expect(greetingFor(at)).toBe(greeting);
  });
});

describe('focusSentence', () => {
  it('is calm and specific, and never a wall of numbers', () => {
    expect(focusSentence(0, 0)).toBe('Nothing needs you. Go build something.');
    expect(focusSentence(1, 0)).toBe('One thing needs you.');
    expect(focusSentence(4, 0)).toBe('One thing first, then three more.');
    expect(focusSentence(4, 2)).toBe(
      'One thing first, then three more. 2 are new since your last visit.',
    );
    expect(focusSentence(2, 1)).toBe(
      'One thing first, then one more. 1 is new since your last visit.',
    );
  });
});
