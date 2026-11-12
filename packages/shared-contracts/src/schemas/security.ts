import { z } from 'zod/v4';
import { isPlainHttpUrl } from './agents.js';

/**
 * security.scan  (plan task 17, ledger BK-2: the security half)
 *
 * One kind of scan and nothing else: an OWASP ZAP **baseline** scan, which spiders the target
 * for a bounded number of minutes and then reports what passive rules saw. No active scan, no
 * authentication, no add-ons, no ZAP command line from outside: the runner
 * (`apps/runner/src/zap-execution.ts`) builds the argv itself from these fields.
 *
 * As with `load.ts`, the ceiling lives in the contract because the API refuses a request above
 * it (`SecurityScanInputSchema`) and the runner refuses a job above it
 * (`ZapJobConfigurationSchema`) even if the row was written by something else.
 */
export const ZAP_MAX_SPIDER_MINUTES = 10;
export const ZAP_DEFAULT_SPIDER_MINUTES = 1;

const spiderMinutes = z.number().int().min(1).max(ZAP_MAX_SPIDER_MINUTES);

/**
 * Input of `POST /api/v1/agents/security/scan`.
 *
 * Strict: there is no `command`, no `args`, no rules file, no timeout. `targetUrl` is required
 * and only its shape is checked here (http or https, no credentials); the runner enforces
 * `RUNNER_ALLOWED_TARGET_URLS`, and a target it refuses becomes a `config_failed` run.
 */
export const SecurityScanInputSchema = z.strictObject({
  targetUrl: z.string().refine(isPlainHttpUrl, 'must be an http(s) URL without credentials'),
  spiderMinutes: spiderMinutes.optional(),
  projectId: z.string().min(1).optional(),
  environmentId: z.string().min(1).optional(),
  releaseId: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
});
export type SecurityScanInput = z.infer<typeof SecurityScanInputSchema>;

/** What a security job carries in `configuration.zap`, every value explicit. */
export const ZapJobConfigurationSchema = z.strictObject({
  scan: z.literal('baseline'),
  spiderMinutes,
});
export type ZapJobConfiguration = z.infer<typeof ZapJobConfigurationSchema>;
