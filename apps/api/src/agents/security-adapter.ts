/**
 * security-adapter.ts — the security agent domain (plan task 17, ledger BK-2).
 *
 * What the three actions mean here, decided from what the runner can honestly do:
 *
 * - **`scan`** — one OWASP ZAP **baseline** scan of a target URL, bounded by
 *   `spiderMinutes`. It queues a job that requires the `zap` capability and carries
 *   `configuration.zap = { scan: 'baseline', spiderMinutes }` plus `configuration.targetUrl`;
 *   the runner (`apps/runner` `zap-execution.ts`) re-validates both against the same contract
 *   ceiling and `RUNNER_ALLOWED_TARGET_URLS`, builds the `zap-baseline.py` argv itself, and turns
 *   the XML report into test events through `@lupin/reporter`'s `zap-xml` adapter. The answer is
 *   the accepted run (HTTP 202); status is read through the runs API.
 * - **`run`** — *not supported.* An active scan attacks the target; nothing here bounds what it
 *   sends, so the only scan offered is the passive baseline under `scan`. Stays `501`.
 * - **`generate`** — *not supported.* Writing scan rules or a ZAP plan needs the AI gateway and a
 *   destination for the file; neither is wired to this domain. Stays `501`.
 *
 * The job timeout is **derived**: the spider minutes plus {@link SECURITY_TIMEOUT_GRACE_MS} for
 * ZAP's start-up, the passive-scan drain and the report write.
 */
import {
  SecurityScanInputSchema,
  ZAP_DEFAULT_SPIDER_MINUTES,
  type SecurityScanInput,
} from '@lupin/shared-contracts';
import type { ToolRegistry } from '@lupin/tool-sdk';
import type { ExecutionStore } from '../execution/types.js';
import type { SubmittableRun } from '../execution/run-submission.js';
import { createExecutionBridgeAdapter, defineAcceptedRunOperation } from './execution-bridge.js';

/** Why the pairs that stay `501` do. Rendered into the refusal body as `reason`. */
export const SECURITY_UNSUPPORTED_REASONS: Readonly<Record<string, string>> = {
  run: 'Only the passive ZAP baseline scan is offered (security.scan); an active scan attacks the target and nothing here bounds what it would send.',
  generate:
    'Generating scan rules or a ZAP plan needs the AI gateway and a destination for the file; neither is wired to the security domain.',
};

/** Added to the spider time for ZAP start-up, the passive-scan drain and the report write. */
export const SECURITY_TIMEOUT_GRACE_MS = 5 * 60_000;

export interface SecurityAgentDeps {
  registry: ToolRegistry;
  store: ExecutionStore;
  workspaceId: string;
  requireIdempotencyKey: boolean;
}

/** The run request a validated `security.scan` input stands for. */
export function securityScanRequest(input: SecurityScanInput): SubmittableRun {
  const spiderMinutes = input.spiderMinutes ?? ZAP_DEFAULT_SPIDER_MINUTES;
  return {
    source: 'agent:security',
    framework: 'zap',
    testType: 'security',
    requiredCapabilities: ['zap'],
    configuration: {
      zap: { scan: 'baseline', spiderMinutes },
      targetUrl: input.targetUrl,
    },
    timeoutMs: spiderMinutes * 60_000 + SECURITY_TIMEOUT_GRACE_MS,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
    ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.commit === undefined ? {} : { commit: input.commit }),
  };
}

/** Register `security.scan`. `security.run` and `security.generate` are deliberately absent. */
export function registerSecurityAgent(deps: SecurityAgentDeps): void {
  deps.registry.register(
    defineAcceptedRunOperation({
      domain: 'security',
      action: 'scan',
      input: SecurityScanInputSchema,
    }),
    createExecutionBridgeAdapter<SecurityScanInput>({
      id: 'security.zap-baseline',
      store: deps.store,
      workspaceId: deps.workspaceId,
      requireIdempotencyKey: deps.requireIdempotencyKey,
      toRunRequest: securityScanRequest,
    }),
  );
}
