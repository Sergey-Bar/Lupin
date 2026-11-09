import { describe, expect, it } from 'vitest';
import type { AttentionItem } from './attention.js';
import { rowsFor } from './rows.js';

const item = (id: string, severity: AttentionItem['severity'] = 'bad'): AttentionItem => ({
  id,
  severity,
  title: id,
  detail: '',
  action: { label: 'Open', to: '/x' },
  at: '2026-11-09T10:00:00.000Z',
});

describe('rowsFor', () => {
  const items = [
    item('run-failed-1'),
    item('run-stuck-2', 'caution'),
    item('pull-7'),
    item('delivery-3', 'caution'),
    item('health-p1', 'caution'),
  ];

  it('groups what is left after the first thing into titled rows, empty rows dropped', () => {
    expect(
      rowsFor(null, items).map((row) => [row.title, row.items.map((entry) => entry.id)]),
    ).toEqual([
      ['Broke since yesterday', ['run-failed-1', 'run-stuck-2']],
      ['Waiting on you', ['pull-7', 'delivery-3']],
      ['Health to watch', ['health-p1']],
    ]);
    expect(rowsFor(null, [item('run-failed-1')]).map((row) => row.title)).toEqual([
      'Broke since yesterday',
    ]);
  });

  it('leads a QA lead with health and delivery, keeping every row', () => {
    expect(rowsFor('lead', items).map((row) => row.title)).toEqual([
      'Health to watch',
      'Waiting on you',
      'Broke since yesterday',
    ]);
  });
});
