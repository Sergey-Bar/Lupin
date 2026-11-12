import { describe, expect, it } from 'vitest';
import { plainError } from './plain-error.js';

describe('plainError', () => {
  it('turns a bare status line into a sentence a person can act on', () => {
    expect(plainError('HTTP 502')).toBe(
      "Lupin's server isn't answering right now. Try again in a moment.",
    );
    expect(plainError('HTTP 500')).toBe(
      "Lupin's server isn't answering right now. Try again in a moment.",
    );
    expect(plainError('HTTP 403')).toBe("Your role can't open this. Ask an admin for access.");
    expect(plainError('HTTP 401')).toBe('Your session ended. Sign in again.');
    expect(plainError('HTTP 404')).toBe("This isn't here any more.");
  });

  it('treats a dropped connection the same way as a server that is down', () => {
    expect(plainError('Failed to fetch')).toBe(
      "Lupin's server isn't answering right now. Try again in a moment.",
    );
    expect(plainError('NetworkError when attempting to fetch resource.')).toBe(
      "Lupin's server isn't answering right now. Try again in a moment.",
    );
  });

  it("keeps the server's own sentence, which already explains itself", () => {
    expect(plainError('Database unavailable')).toBe('Database unavailable');
  });
});
