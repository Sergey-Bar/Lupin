import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evidenceDomains, type DomainEvidence, type Severity } from './evidence-domains.js';
import { defaultPolicy, evaluateQualityGate } from './quality-gate.js';
import type { DomainName } from './types.js';

/**
 * GATE-1 and GATE-2 in docs/quality/property-invariants.json (plan task 16).
 *
 * GATE-1: a domain the policy requires, with no evidence for it, never lets the gate pass.
 * GATE-2: a security or accessibility finding at or above the policy's severity always fails
 * its domain, whatever else the evidence says.
 */
const SEED = 20261112;
const params = { seed: SEED, numRuns: 300 } as const;

const severity = fc.constantFrom<Severity>('critical', 'high', 'medium', 'low', 'info');
const evidence: fc.Arbitrary<DomainEvidence> = fc.record(
  {
    sarif: fc.array(severity, { maxLength: 5 }),
    zap: fc.array(fc.record({ failed: fc.boolean() }), { maxLength: 3 }),
    axe: fc.array(severity, { maxLength: 5 }),
    k6: fc.array(fc.constantFrom('passed' as const, 'failed' as const, 'unknown' as const), {
      maxLength: 5,
    }),
  },
  { requiredKeys: [] },
);
const domain = fc.constantFrom<DomainName>('security', 'accessibility', 'performance');

function withoutEvidenceFor(sample: DomainEvidence, required: DomainName): DomainEvidence {
  const copy = { ...sample };
  if (required === 'security') {
    delete copy.sarif;
    delete copy.zap;
  }
  if (required === 'accessibility') delete copy.axe;
  if (required === 'performance') delete copy.k6;
  return copy;
}

const passingRun = {
  id: 'r1',
  outcome: 'passed' as const,
  summary: {
    total: 3,
    passed: 3,
    failed: 0,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: 10,
  },
  rawEvidenceRefs: ['evidence:1'],
};

describe('GATE-1: no evidence never yields passed', () => {
  it('holds for every required domain and every other piece of evidence', () => {
    fc.assert(
      fc.property(evidence, domain, (sample, required) => {
        const policy = {
          ...defaultPolicy('ws-1'),
          requiredDomains: ['browser', required] as DomainName[],
        };
        const domains = evidenceDomains(withoutEvidenceFor(sample, required), policy);
        expect(domains[required]).toBeUndefined();
        const gate = evaluateQualityGate({
          run: passingRun,
          policy,
          domainStatuses: { ...domains, browser: 'passed' },
        });
        expect(gate.status).not.toBe('passed');
      }),
      params,
    );
  });

  it('the property harness can fail: a wrong claim that evidence is optional is refuted', () => {
    // The same check against a gate that treats a missing domain as passed must fail, or the
    // property above proves nothing.
    const refutes = () =>
      fc.assert(
        fc.property(domain, (required) => {
          const policy = {
            ...defaultPolicy('ws-1'),
            requiredDomains: ['browser', required] as DomainName[],
          };
          const gate = evaluateQualityGate({
            run: passingRun,
            policy,
            domainStatuses: { browser: 'passed', [required]: 'passed' },
          });
          expect(gate.status).not.toBe('passed');
        }),
        params,
      );
    expect(refutes).toThrow();
  });
});

describe('GATE-2: a finding at or above the threshold fails its domain', () => {
  it('holds for security and accessibility', () => {
    fc.assert(
      fc.property(evidence, fc.constantFrom('critical' as const, 'high' as const), (sample, at) => {
        const withFinding: DomainEvidence = {
          ...sample,
          sarif: [...(sample.sarif ?? []), at],
          axe: [...(sample.axe ?? []), at],
        };
        const domains = evidenceDomains(withFinding, defaultPolicy('ws-1'));
        expect(domains.security).toBe('failed');
        expect(domains.accessibility).toBe('failed');
      }),
      params,
    );
  });
});
