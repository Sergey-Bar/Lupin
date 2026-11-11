/**
 * Quiet hours: hours of the day, in a subscription's own timezone, when no report is delivered.
 *
 * `[start, end)`: the start hour is quiet and the end hour is not. A window whose start is after
 * its end wraps midnight (22 → 7 is overnight). A report that comes due inside the window waits
 * until it ends; one due outside it goes at once.
 */
export interface QuietHours {
  start: number;
  end: number;
}

const STEP_MS = 15 * 60_000;
/** A day and an hour of 15-minute steps: past any window, across a daylight-saving change. */
const MAX_STEPS = 25 * 4;

function localTime(at: Date, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: 'hour' | 'minute') =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { hour: value('hour'), minute: value('minute') };
}

function isQuiet(hour: number, quiet: QuietHours): boolean {
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}

/** When the quiet window `at` falls in ends; `null` when `at` is not in quiet hours. */
export function quietUntil(at: Date, timezone: string, quiet: QuietHours | null): Date | null {
  if (quiet === null || quiet.start === quiet.end) return null;
  if (!isQuiet(localTime(at, timezone).hour, quiet)) return null;
  // The first quarter hour after `at` that is the end hour, on the hour, in local time. Every
  // timezone offset in use is a multiple of 15 minutes, so the end is always on a step.
  let candidate = Math.floor(at.getTime() / STEP_MS) * STEP_MS;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    candidate += STEP_MS;
    const local = localTime(new Date(candidate), timezone);
    if (local.hour === quiet.end && local.minute === 0) return new Date(candidate);
  }
  return null;
}
