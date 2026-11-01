import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEALTH_WEIGHTS,
  FINDINGS_DECAY,
  GATE_CEILING,
  GRADE_FORMULA_VERSION,
  LETTER_FLOORS,
  METRIC_TARGET,
  SEVERITY_PENALTY,
} from './grade.js';

/**
 * The cockpit never compares two score points computed by different formulas, so a change to
 * the formula must change `GRADE_FORMULA_VERSION`. This pins the formula's tunable constants
 * to the version: change a weight, a penalty, the decay, a letter floor or the gate ceiling and
 * this fails until the version is raised and the new pair recorded below.
 *
 * It covers the constants, not the control flow. A change to the arithmetic in `grade()` that
 * touches no constant is a code-review matter and the version comment on the constant says so.
 */
const RECORDED: ReadonlyArray<readonly [version: number, fingerprint: string]> = [
  [1, '9a072a55d44a44453f8fccd772ef5b782022c76a08fb2700932a6f675443ae88'],
];

function fingerprint(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        weights: DEFAULT_HEALTH_WEIGHTS,
        penalty: SEVERITY_PENALTY,
        decay: FINDINGS_DECAY,
        floors: LETTER_FLOORS,
        gateCeiling: GATE_CEILING,
        metricTarget: METRIC_TARGET,
      }),
    )
    .digest('hex');
}

describe('GRADE_FORMULA_VERSION', () => {
  it('is a positive integer, because 0 is what rows from before the version existed carry', () => {
    expect(Number.isInteger(GRADE_FORMULA_VERSION)).toBe(true);
    expect(GRADE_FORMULA_VERSION).toBeGreaterThan(0);
  });

  it('is recorded against the fingerprint of the constants it was raised for', () => {
    const recorded = RECORDED.find(([version]) => version === GRADE_FORMULA_VERSION);
    expect(recorded, `version ${GRADE_FORMULA_VERSION} has no row in RECORDED`).toBeDefined();
    expect(fingerprint()).toBe(recorded?.[1]);
  });

  it('is refuted by a changed constant: the fingerprint moves when a weight does', () => {
    const changed = createHash('sha256')
      .update(
        JSON.stringify({
          weights: { ...DEFAULT_HEALTH_WEIGHTS, security: DEFAULT_HEALTH_WEIGHTS.security + 1 },
          penalty: SEVERITY_PENALTY,
          decay: FINDINGS_DECAY,
          floors: LETTER_FLOORS,
          gateCeiling: GATE_CEILING,
          metricTarget: METRIC_TARGET,
        }),
      )
      .digest('hex');
    expect(changed).not.toBe(fingerprint());
  });

  it('keeps every recorded version distinct and in order', () => {
    const versions = RECORDED.map(([version]) => version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });
});
