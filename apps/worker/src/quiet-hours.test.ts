import { describe, expect, it } from 'vitest';
import { quietUntil } from './quiet-hours.js';

const at = (iso: string) => new Date(iso);

describe('quietUntil', () => {
  it('is null outside quiet hours, and with none', () => {
    expect(quietUntil(at('2026-11-11T12:00:00.000Z'), 'UTC', { start: 22, end: 7 })).toBeNull();
    expect(quietUntil(at('2026-11-11T23:00:00.000Z'), 'UTC', null)).toBeNull();
  });

  it('holds a report due overnight until the window ends the next morning', () => {
    expect(
      quietUntil(at('2026-11-11T23:30:00.000Z'), 'UTC', { start: 22, end: 7 })?.toISOString(),
    ).toBe('2026-11-12T07:00:00.000Z');
    expect(
      quietUntil(at('2026-11-12T03:10:00.000Z'), 'UTC', { start: 22, end: 7 })?.toISOString(),
    ).toBe('2026-11-12T07:00:00.000Z');
  });

  it('treats the start hour as quiet and the end hour as not', () => {
    expect(quietUntil(at('2026-11-11T22:00:00.000Z'), 'UTC', { start: 22, end: 7 })).not.toBeNull();
    expect(quietUntil(at('2026-11-12T07:00:00.000Z'), 'UTC', { start: 22, end: 7 })).toBeNull();
  });

  it('reads the hours in the subscription’s timezone', () => {
    // 20:30 UTC is 22:30 in Jerusalem (UTC+2 in November): quiet until 07:00 there, 05:00 UTC.
    expect(
      quietUntil(at('2026-11-11T20:30:00.000Z'), 'Asia/Jerusalem', {
        start: 22,
        end: 7,
      })?.toISOString(),
    ).toBe('2026-11-12T05:00:00.000Z');
    // And a half-hour zone: 23:00 in Kolkata is 17:30 UTC; 07:00 there is 01:30 UTC.
    expect(
      quietUntil(at('2026-11-11T17:30:00.000Z'), 'Asia/Kolkata', {
        start: 22,
        end: 7,
      })?.toISOString(),
    ).toBe('2026-11-12T01:30:00.000Z');
  });

  it('handles a window inside one day, such as a lunch break', () => {
    expect(
      quietUntil(at('2026-11-11T12:15:00.000Z'), 'UTC', { start: 12, end: 13 })?.toISOString(),
    ).toBe('2026-11-11T13:00:00.000Z');
    expect(quietUntil(at('2026-11-11T13:15:00.000Z'), 'UTC', { start: 12, end: 13 })).toBeNull();
  });
});
