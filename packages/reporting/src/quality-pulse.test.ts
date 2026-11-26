import { describe, expect, it } from 'vitest';
import { QualityPulseSchema } from '@lupin/shared-contracts';
import { qualityPulse, type PulseInput, type PulseReading } from './quality-pulse.js';

const none: PulseReading = { current: null, previous: null };
const same = (value: number): PulseReading => ({ current: value, previous: value });

function input(overrides: Partial<PulseInput> = {}): PulseInput {
  return {
    projectId: 'p1',
    evaluatedAt: '2026-11-26T12:00:00.000Z',
    windowDays: 7,
    runs: { current: 10, previous: 10 },
    gate: same(1),
    passRate: same(96),
    failingTests: same(2),
    flakyRate: same(1),
    coverage: same(80),
    aiChangeFailureRate: none,
    aiRevertRate: none,
    aiDiffCoverage: none,
    ...overrides,
  };
}

describe('qualityPulse', () => {
  it('is steady when every measured sign stayed inside its noise', () => {
    const pulse = qualityPulse(input({ passRate: { current: 96.3, previous: 96 } }));
    expect(QualityPulseSchema.parse(pulse)).toEqual(pulse);
    expect(pulse.direction).toBe('steady');
    expect(pulse.cause).toBeNull();
    expect(pulse.sentence).toBe('Steady: Nothing moved past its noise across 5 signs.');
    expect(pulse.confidence).toBe('high');
  });

  it('says worse, naming the AI-written coverage that fell, as the plan demo reads', () => {
    const pulse = qualityPulse(input({ aiDiffCoverage: { current: 64, previous: 70 } }));
    expect(pulse.direction).toBe('worse');
    expect(pulse.cause).toEqual({
      vital: 'ai-diff-coverage',
      text: 'Coverage of AI-written lines fell 6.0 pts',
    });
    expect(pulse.sentence).toBe('Worse: Coverage of AI-written lines fell 6.0 pts.');
    expect(pulse.vitals.find((vital) => vital.id === 'ai-diff-coverage')).toMatchObject({
      ai: true,
      delta: -6,
    });
  });

  it('is worse when anything got worse, and lists what improved beside it', () => {
    const pulse = qualityPulse(
      input({ passRate: { current: 99, previous: 90 }, failingTests: { current: 5, previous: 2 } }),
    );
    expect(pulse.direction).toBe('worse');
    expect(pulse.cause?.text).toBe('Failing tests rose by 3');
    expect(pulse.alsoMoved).toEqual([{ vital: 'pass-rate', text: 'Pass rate rose 9.0 pts' }]);
  });

  it('ranks the gate turning red above a larger number elsewhere', () => {
    const pulse = qualityPulse(
      input({ gate: { current: 0, previous: 1 }, coverage: { current: 78, previous: 80 } }),
    );
    expect(pulse.cause).toEqual({ vital: 'gate', text: 'The quality gate started failing' });
  });

  it('is better when something improved and nothing got worse', () => {
    const pulse = qualityPulse(
      input({
        gate: { current: 1, previous: 0 },
        aiChangeFailureRate: { current: 4, previous: 12 },
      }),
    );
    expect(pulse.direction).toBe('better');
    // The gate passing again is categorical and leads; the AI improvement is still a sign.
    expect(pulse.cause?.text).toBe('The quality gate passes again');
    expect(pulse.vitals.find((vital) => vital.id === 'ai-change-failure-rate')?.direction).toBe(
      'better',
    );
    expect(pulse.alsoMoved).toEqual([]);
  });

  it('names the furthest numeric move, in multiples of its noise, when the gate held', () => {
    const pulse = qualityPulse(
      input({
        aiChangeFailureRate: { current: 4, previous: 12 },
        passRate: { current: 98, previous: 96 },
      }),
    );
    // 8 points over a noise of 2 is four noises; 2 points over 0.5 is also four, so the order
    // of importance decides, and pass rate comes first.
    expect(pulse.cause?.text).toBe('Pass rate rose 2.0 pts');
  });

  it('is unknown, never steady or better, when nothing can be compared', () => {
    const pulse = qualityPulse(
      input({
        runs: { current: 3, previous: 0 },
        gate: { current: 1, previous: null },
        passRate: { current: 100, previous: null },
        failingTests: none,
        flakyRate: none,
        coverage: none,
      }),
    );
    expect(pulse.direction).toBe('unknown');
    expect(pulse.confidence).toBe('low');
    expect(pulse.sentence).toBe('Unknown: Not enough evidence in both windows to compare.');
  });

  it('reads confidence from how much was compared over how many runs', () => {
    expect(qualityPulse(input({ runs: { current: 3, previous: 2 } })).confidence).toBe('medium');
    expect(qualityPulse(input({ runs: { current: 30, previous: 1 } })).confidence).toBe('low');
  });

  it('treats a value that is not finite as missing', () => {
    const pulse = qualityPulse(input({ coverage: { current: Number.NaN, previous: 80 } }));
    expect(pulse.vitals.find((vital) => vital.id === 'coverage')?.direction).toBe('unknown');
  });
});
