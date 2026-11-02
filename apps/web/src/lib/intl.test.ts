import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatMonthDay,
  formatNumber,
  formatPlain,
  formatRelative,
} from './intl.js';

describe('intl formatting', () => {
  it('keeps the English output this app always had', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatMonthDay('2026-10-20')).toBe('Oct 20');
    expect(formatCompact(12_500)).toBe('12.5K');
    expect(formatPlain(0.54)).toBe('0.5');
  });
});

describe('formatRelative', () => {
  const NOW = new Date('2026-10-23T12:00:00.000Z');
  const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const HOUR = 3_600_000;

  it('says how long ago in the largest sensible unit', () => {
    expect(formatRelative(before(30_000), NOW)).toBe('now');
    expect(formatRelative(before(5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(formatRelative(before(3 * HOUR), NOW)).toBe('3 hours ago');
    expect(formatRelative(before(48 * HOUR), NOW)).toBe('2 days ago');
    expect(formatRelative(before(90 * 24 * HOUR), NOW)).toBe('3 months ago');
  });

  it('reads a time in the future as in the future', () => {
    expect(formatRelative(new Date(NOW.getTime() + 2 * HOUR).toISOString(), NOW)).toBe(
      'in 2 hours',
    );
  });

  it('is empty rather than "Invalid Date" for a value that is not a time', () => {
    expect(formatRelative('not a date', NOW)).toBe('');
  });
});
