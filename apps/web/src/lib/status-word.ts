/**
 * A machine status as a word a person reads: `not_configured` → "Not configured".
 *
 * Sentence case, like every other label in the product. Capitals were used to make a status
 * stand out; the badge's tone already does that, and a word in capitals reads as shouting.
 */
export function statusWord(status: string | null | undefined): string {
  if (status === undefined || status === null || status.trim() === '') return 'Pending';
  const words = status.trim().replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
