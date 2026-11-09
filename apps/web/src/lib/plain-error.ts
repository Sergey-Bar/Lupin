/**
 * A failure as a sentence a person can act on.
 *
 * The clients keep the technical text ("HTTP 502", "Failed to fetch") because it is what a log
 * and a bug report need. A screen leads with this instead and keeps the original under a
 * "Technical details" fold. A sentence the server wrote for a human is already that, so it
 * passes through unchanged.
 */
const DOWN = "Lupin's server isn't answering right now. Try again in a moment.";

export function plainError(message: string): string {
  const status = /^\s*HTTP (\d{3})\s*$/u.exec(message)?.[1];
  if (status !== undefined) {
    if (status === '401') return 'Your session ended. Sign in again.';
    if (status === '403') return "Your role can't open this. Ask an admin for access.";
    if (status === '404') return "This isn't here any more.";
    return DOWN;
  }
  if (/failed to fetch|networkerror|load failed|econnrefused/iu.test(message)) return DOWN;
  return message;
}
