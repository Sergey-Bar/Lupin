/**
 * A bare "not found" from the API means the thing has not been set up yet (no project, no
 * GitHub connection), not that something broke. Any longer sentence is the server explaining a
 * real failure and is shown as written. One rule, so every screen draws the line in one place.
 */
export function isNothingYet(message: string): boolean {
  return /^\s*not found\.?\s*$/iu.test(message);
}
