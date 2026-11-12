import {
  IntegrationMaturitySchema,
  REPORT_FORMATS,
  type IntegrationMaturity,
  type IntegrationMaturityLevel,
  type IntegrationEvidenceStatus,
} from '@lupin/shared-contracts';

export type { IntegrationMaturity, IntegrationMaturityLevel, IntegrationEvidenceStatus };

const INTEGRATION_MATURITY_SOURCE = [
  {
    id: 'playwright-test',
    name: 'Playwright Test',
    domain: 'browser',
    level: 'L4',
    capabilities: ['browser', 'test-execution', 'evidence-upload'],
    adapterVersion: 'execution-1',
    evidenceStatus: 'verified',
    evidence: ['runner-protocol', 'playwright-execution', 'smoke-fixtures'],
  },
  {
    id: 'playwright.execution',
    name: 'Playwright execution adapter',
    domain: 'browser',
    level: 'L4',
    capabilities: ['browser', 'test-execution', 'evidence-upload'],
    adapterVersion: 'execution-1',
    evidenceStatus: 'verified',
    evidence: ['runner-protocol', 'playwright-execution', 'smoke-fixtures'],
  },
  {
    id: 'junit',
    name: 'JUnit',
    domain: 'import',
    level: 'L2',
    capabilities: ['import', 'normalized-results'],
    adapterVersion: 'junit-xml',
    evidenceStatus: 'verified',
    evidence: ['reporter-upload-door'],
  },
  {
    id: 'playwright-json',
    name: 'Playwright JSON',
    domain: 'import',
    level: 'L2',
    capabilities: ['import', 'normalized-results'],
    adapterVersion: 'legacy-1',
    evidenceStatus: 'verified',
    evidence: ['legacy-reporter-upload'],
  },
  {
    id: 'cypress',
    name: 'Cypress',
    domain: 'browser',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'not_configured',
    evidence: [],
  },
  {
    id: 'selenium',
    name: 'Selenium',
    domain: 'browser',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'webdriverio',
    name: 'WebdriverIO',
    domain: 'browser',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'vitest',
    name: 'Vitest',
    domain: 'unit',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'jest',
    name: 'Jest',
    domain: 'unit',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'pytest',
    name: 'pytest',
    domain: 'unit',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  // Built and tested against the runner's own adapter (`apps/runner/src/api-run.ts`), queued by
  // the `api` agent; `implemented`, not `verified`, because no run against a real service
  // is recorded (ledger MNT-182).
  {
    id: 'bruno',
    name: 'Bruno',
    domain: 'api',
    level: 'L2',
    capabilities: ['api', 'test-execution'],
    adapterVersion: 'api-run',
    evidenceStatus: 'implemented',
    evidence: ['api-agent', 'runner-api-run'],
  },
  {
    id: 'newman',
    name: 'Newman',
    domain: 'api',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  // The runner's bounded k6 adapter (`apps/runner/src/k6-execution.ts`), queued by the `load`
  // agent. `implemented`: the runner image is still a stub (`runner.oci`), so a k6 run needs
  // a runner host with k6 installed (ledger MNT-182).
  {
    id: 'k6',
    name: 'k6',
    domain: 'performance',
    level: 'L2',
    capabilities: ['k6', 'test-execution'],
    adapterVersion: 'k6-execution',
    evidenceStatus: 'implemented',
    evidence: ['load-agent', 'runner-k6-execution'],
  },
  // The runner's ZAP baseline adapter (`apps/runner/src/zap-execution.ts`), queued by the
  // `security` agent (plan task 17). `implemented`, not `verified`: no scan against a real
  // target through a runner carrying ZAP is recorded (ledger BK-2).
  {
    id: 'zap',
    name: 'OWASP ZAP',
    domain: 'security',
    level: 'L2',
    capabilities: ['zap', 'test-execution'],
    adapterVersion: 'zap-execution',
    evidenceStatus: 'implemented',
    evidence: ['security-agent', 'runner-zap-execution'],
  },
  {
    id: 'appium',
    name: 'Appium',
    domain: 'mobile',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'unsupported',
    evidence: [],
  },
  {
    id: 'maestro',
    name: 'Maestro',
    domain: 'mobile',
    level: 'L0',
    capabilities: [],
    adapterVersion: 'none',
    evidenceStatus: 'not_configured',
    evidence: [],
  },
];

export const INTEGRATION_MATURITY_REGISTRY: readonly IntegrationMaturity[] =
  IntegrationMaturitySchema.array().parse(
    withUploadDoor(INTEGRATION_MATURITY_SOURCE, REPORT_FORMATS),
  );

/**
 * The rows the reporter upload door makes true, derived from its format table rather than
 * written by hand (plan task 20): a producer the door reads carries `import` and the
 * `reporter-upload-door` evidence, and an L0 row becomes L2 `implemented`. A producer the door
 * reads with no row gets one. So ZAP, which the door has read since its adapter landed, no
 * longer reads as absent, and a format added to the table is reflected without an edit here.
 */
export function withUploadDoor(
  source: ReadonlyArray<(typeof INTEGRATION_MATURITY_SOURCE)[number]>,
  formats: ReadonlyArray<{ id: string; producer: string; spellings: readonly string[] }>,
): Array<(typeof INTEGRATION_MATURITY_SOURCE)[number]> {
  const door = formats.filter((format) => format.spellings.length > 0);
  const rows = source.map((row) => ({
    ...row,
    capabilities: [...row.capabilities],
    evidence: [...row.evidence],
  }));
  for (const format of door) {
    const row = rows.find((entry) => entry.id === format.producer);
    if (row === undefined) {
      rows.push({
        id: format.producer,
        name: format.producer,
        domain: 'import',
        level: 'L2',
        capabilities: ['import', 'normalized-results'],
        adapterVersion: format.id,
        evidenceStatus: 'implemented',
        evidence: ['reporter-upload-door'],
      });
      continue;
    }
    if (!row.capabilities.includes('import')) row.capabilities.push('import');
    if (!row.evidence.includes('reporter-upload-door')) row.evidence.push('reporter-upload-door');
    if (row.level === 'L0') {
      row.level = 'L2';
      row.adapterVersion = format.id;
      row.evidenceStatus = 'implemented';
    }
  }
  return rows;
}

export function listIntegrationMaturity(): IntegrationMaturity[] {
  return INTEGRATION_MATURITY_REGISTRY.map((entry) => ({
    ...entry,
    capabilities: [...entry.capabilities],
    evidence: [...entry.evidence],
  }));
}

export function integrationMaturity(id: string): IntegrationMaturity | null {
  const entry = INTEGRATION_MATURITY_REGISTRY.find((item) => item.id === id);
  return entry
    ? { ...entry, capabilities: [...entry.capabilities], evidence: [...entry.evidence] }
    : null;
}
