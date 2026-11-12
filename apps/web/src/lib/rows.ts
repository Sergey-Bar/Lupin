import type { AttentionItem } from './attention.js';
import type { PersonaId } from './persona.js';

/**
 * Now's what's-next rows, Netflix-style: everything after the first thing, grouped by the kind
 * of work it is. Pure, so the grouping and the per-role order are unit tests. A row with
 * nothing in it is dropped rather than drawn as a heading over nothing.
 */
export interface NowRow {
  id: 'broke' | 'waiting' | 'health' | 'other';
  title: string;
  items: AttentionItem[];
}

const KINDS: readonly { id: NowRow['id']; title: string; prefixes: readonly string[] }[] = [
  { id: 'broke', title: 'Broke since yesterday', prefixes: ['run-failed-', 'run-stuck-'] },
  { id: 'waiting', title: 'Waiting on you', prefixes: ['pull-', 'delivery-'] },
  { id: 'health', title: 'Health to watch', prefixes: ['health-'] },
];

const ORDER: Record<PersonaId, readonly NowRow['id'][]> = {
  manual: ['broke', 'waiting', 'health', 'other'],
  automation: ['broke', 'health', 'waiting', 'other'],
  lead: ['health', 'waiting', 'broke', 'other'],
};

export function rowsFor(persona: PersonaId | null, items: readonly AttentionItem[]): NowRow[] {
  const rows: NowRow[] = [
    ...KINDS.map((kind) => ({ id: kind.id, title: kind.title, items: [] as AttentionItem[] })),
    { id: 'other', title: 'Also worth a look', items: [] },
  ];
  for (const entry of items) {
    const kind = KINDS.find((candidate) =>
      candidate.prefixes.some((prefix) => entry.id.startsWith(prefix)),
    );
    rows.find((row) => row.id === (kind?.id ?? 'other'))?.items.push(entry);
  }
  const order = persona === null ? ORDER.manual : ORDER[persona];
  return rows
    .filter((row) => row.items.length > 0)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
