import type { AttentionItem } from './attention.js';

/**
 * Who is reading, so Now leads with what that person does first. Chosen once in Settings and
 * kept per browser. It only reorders and adds shortcuts: every item is still on the page, and
 * something broken always outranks something to watch, whatever the role.
 */
export type PersonaId = 'manual' | 'automation' | 'lead';

export const PERSONAS: readonly { id: PersonaId; label: string; question: string }[] = [
  { id: 'manual', label: 'Manual QA', question: 'What should I test today?' },
  { id: 'automation', label: 'Automation engineer', question: 'What is broken or flaky?' },
  { id: 'lead', label: 'QA lead', question: 'Can we ship?' },
];

/** Which kinds of item each role reaches for first, by the item id's prefix. */
const FIRST: Record<PersonaId, readonly string[]> = {
  manual: ['run-failed-', 'run-stuck-', 'pull-'],
  automation: ['run-failed-', 'run-stuck-', 'delivery-'],
  lead: ['health-', 'pull-', 'run-failed-'],
};

function rank(persona: PersonaId, item: AttentionItem): number {
  const index = FIRST[persona].findIndex((prefix) => item.id.startsWith(prefix));
  return index < 0 ? FIRST[persona].length : index;
}

export function forPersona(
  persona: PersonaId | null,
  items: readonly AttentionItem[],
): AttentionItem[] {
  if (persona === null) return [...items];
  const severity = (item: AttentionItem) => (item.severity === 'bad' ? 0 : 1);
  // A stable sort: severity first, then the role's preference, then the original ranking.
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        severity(a.item) - severity(b.item) ||
        rank(persona, a.item) - rank(persona, b.item) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

const TOOLS: Record<PersonaId, readonly { label: string; to: string }[]> = {
  manual: [
    { label: 'Latest runs', to: '/dashboard/runs' },
    { label: 'Test history', to: '/dashboard/insights' },
    { label: 'Start a browser run', to: '/dashboard/runner' },
  ],
  automation: [
    { label: 'Flaky tests', to: '/dashboard/insights' },
    { label: 'Quarantine', to: '/dashboard/quarantine' },
    { label: 'Launch a suite', to: '/dashboard/runner' },
  ],
  lead: [
    { label: 'Release readiness', to: '/dashboard' },
    { label: 'Portfolio', to: '/dashboard/portfolio' },
    { label: 'Pull requests', to: '/dashboard/prs' },
  ],
};

export function personaTools(persona: PersonaId): readonly { label: string; to: string }[] {
  return TOOLS[persona];
}
