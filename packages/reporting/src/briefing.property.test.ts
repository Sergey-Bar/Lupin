import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { composeBriefing, type BriefingInput } from './briefing.js';

/** Property suite for BRIEF-1 and BRIEF-2. Fixed seed and `numRuns`. */
const SEED = 20261114;
const params = { seed: SEED, numRuns: 400 } as const;
const NOW = new Date('2026-11-11T12:00:00.000Z');
const PROJECT = '0d1d4b5e-7b0b-4f7b-9b40-4a8f0b7f1a11';

const input: fc.Arbitrary<BriefingInput> = fc.record({
  scope: fc.constantFrom(
    { kind: 'repository' as const, projectId: PROJECT, name: 'Shop' },
    { kind: 'portfolio' as const, projects: 3 },
  ),
  now: fc.constant(NOW),
  windowDays: fc.integer({ min: 1, max: 90 }),
  merged: fc.option(
    fc.record({
      total: fc.nat({ max: 50 }),
      ai: fc.nat({ max: 50 }),
      highRisk: fc.nat({ max: 5 }),
      unreviewedAi: fc.nat({ max: 5 }),
      tampered: fc.nat({ max: 5 }),
    }),
    { nil: null },
  ),
  deployments: fc.option(fc.nat({ max: 20 }), { nil: null }),
  pace: fc.option(
    fc.record({
      changedLines: fc.nat({ max: 5000 }),
      testsPerKloc: fc.option(fc.nat({ max: 20 }), { nil: null }),
      debt: fc.nat({ max: 5000 }),
      unmeasured: fc.nat({ max: 5000 }),
    }),
    { nil: null },
  ),
  bottlenecks: fc.array(
    fc.constant({ projectId: PROJECT, projectName: 'Shop', sentence: 'Review is the bottleneck.' }),
    { maxLength: 4 },
  ),
  quality: fc.option(
    fc.record({
      headline: fc.constant('Down 2 points.'),
      tone: fc.constantFrom('good' as const, 'caution' as const, 'bad' as const),
    }),
    { nil: null },
  ),
  decisions: fc.array(
    fc.record({
      projectId: fc.constant(PROJECT),
      projectName: fc.constant('Shop'),
      number: fc.integer({ min: 1, max: 999 }),
      title: fc.constant('Change'),
      level: fc.constantFrom('high' as const, 'critical' as const),
      score: fc.integer({ min: 40, max: 120 }),
    }),
    { maxLength: 7 },
  ),
});

describe('BRIEF-1: every briefing line cites its evidence, and ids are unique', () => {
  it('holds for any input', () => {
    fc.assert(
      fc.property(input, (value) => {
        const items = composeBriefing(value).items;
        expect(items.length).toBeGreaterThan(0);
        for (const entry of items) expect(entry.evidence.length).toBeGreaterThan(0);
        expect(new Set(items.map((entry) => entry.id)).size).toBe(items.length);
      }),
      params,
    );
  });
});

describe('BRIEF-2: a window where nothing happened is one line, and never good', () => {
  it('holds for any empty window', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 90 }), (windowDays) => {
        const briefing = composeBriefing({
          scope: { kind: 'repository', projectId: PROJECT, name: 'Shop' },
          now: NOW,
          windowDays,
          merged: { total: 0, ai: 0, highRisk: 0, unreviewedAi: 0, tampered: 0 },
          deployments: 0,
          pace: { changedLines: 0, testsPerKloc: null, debt: 0, unmeasured: 0 },
          bottlenecks: [],
          quality: null,
          decisions: [],
        });
        expect(briefing.items.map((entry) => entry.id)).toEqual(['shape.quiet']);
        expect(briefing.shape).not.toBe('good');
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes a briefing that always has a "merged" line, as a list of zeros would', () => {
    const outcome = fc.check(
      fc.property(input, (value) =>
        composeBriefing(value).items.some((entry) => entry.id === 'shipped.merged'),
      ),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
