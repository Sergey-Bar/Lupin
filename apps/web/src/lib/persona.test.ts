import { describe, expect, it } from 'vitest';
import type { AttentionItem } from './attention.js';
import { PERSONAS, forPersona, personaTools } from './persona.js';

const item = (id: string, severity: AttentionItem['severity'] = 'bad'): AttentionItem => ({
  id,
  severity,
  title: id,
  detail: '',
  action: { label: 'Open', to: '/x' },
  at: '2026-11-09T10:00:00.000Z',
});

describe('the QA roles', () => {
  it('names three roles a QA person recognises', () => {
    expect(PERSONAS.map((persona) => persona.label)).toEqual([
      'Manual QA',
      'Automation engineer',
      'QA lead',
    ]);
  });

  it('leads a QA lead with health and delivery, and an engineer with the runs', () => {
    const items = [item('run-failed-1'), item('health-p1'), item('pull-7')];
    expect(forPersona('lead', items).map((entry) => entry.id)).toEqual([
      'health-p1',
      'pull-7',
      'run-failed-1',
    ]);
    expect(forPersona('automation', items).map((entry) => entry.id)[0]).toBe('run-failed-1');
  });

  it('never puts a caution above something broken, whatever the role', () => {
    const items = [item('run-failed-1', 'bad'), item('health-p1', 'caution')];
    expect(forPersona('lead', items).map((entry) => entry.id)).toEqual([
      'run-failed-1',
      'health-p1',
    ]);
  });

  it('keeps the order as ranked when no role is chosen', () => {
    const items = [item('pull-7'), item('run-failed-1')];
    expect(forPersona(null, items)).toEqual(items);
  });

  it('gives each role three shortcuts to the pages it lives in', () => {
    for (const persona of PERSONAS) {
      const tools = personaTools(persona.id);
      expect(tools, persona.id).toHaveLength(3);
      for (const tool of tools) expect(tool.to.startsWith('/dashboard'), tool.label).toBe(true);
    }
    expect(personaTools('lead').map((tool) => tool.label)).toContain('Release readiness');
  });
});
