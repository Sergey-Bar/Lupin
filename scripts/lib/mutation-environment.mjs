/**
 * The environment `pnpm mutation` runs Stryker under.
 *
 * Vitest's `github-actions` reporter appends a job summary to `GITHUB_STEP_SUMMARY` on every
 * test run, and Stryker runs Vitest once per batch of mutants. On 2026-11-05 the nightly's
 * mutation step wrote 1987 KB against GitHub's 1024 KB limit, and GitHub dropped the whole
 * summary. The scores are summarised by `pnpm mutation:ratchet` in its own step, so the
 * per-run summaries carry nothing that is needed. Without the variable Vitest has no path to
 * write to and writes nothing.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function strykerEnvironment(env) {
  const { GITHUB_STEP_SUMMARY: _summary, ...rest } = env;
  return rest;
}
