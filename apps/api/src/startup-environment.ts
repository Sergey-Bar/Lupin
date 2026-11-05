import path from 'node:path';

/**
 * What `instrument.ts` does before the module graph reads `process.env`, decided from the
 * environment alone so both branches are testable without importing a side-effect module.
 */
export interface StartupEnvironmentPlan {
  /** Read the first `.env` that exists into `process.env`. */
  readonly loadDotEnv: boolean;
  /** Initialise the error reporter. */
  readonly initErrorReporter: boolean;
}

/**
 * A test owns its own environment. Vitest sets `VITEST=true` in every worker, and the
 * authz-matrix generator imports `dist/index.js` with `NODE_ENV=test`. Loading a developer's
 * `.env` there would let the machine decide the result: an open-mode reporter test would see a
 * configured `REPORTER_SECRET`, and the route introspector would see a `DATABASE_URL` and register
 * the database-only routes, so the composed app would not match the committed authz matrix.
 *
 * `VITEST` is compared with the value Vitest writes, not merely tested for presence, so a stray
 * `VITEST=` or `VITEST=false` on a serving process does not switch off `.env` and the reporter.
 */
export function isTestContext(env: NodeJS.ProcessEnv): boolean {
  return env['VITEST'] === 'true' || env['NODE_ENV'] === 'test';
}

/**
 * `LUPIN_SKIP_DOTENV=1` keeps `.env` out of a process whose caller supplies the whole
 * environment, which is what the profile-matrix harness promises: a variable it does not name is
 * absent, not taken from the developer's `.env`. It skips the file only; the error reporter still
 * starts from whatever the environment carries.
 */
export function planStartupEnvironment(env: NodeJS.ProcessEnv): StartupEnvironmentPlan {
  if (isTestContext(env)) return { loadDotEnv: false, initErrorReporter: false };
  return { loadDotEnv: env['LUPIN_SKIP_DOTENV'] !== '1', initErrorReporter: true };
}

/**
 * Where a `.env` may be, from the directory of the running `instrument` module: `apps/api/src`
 * under `tsx`, `apps/api/dist` once built. Root first, because that is where `.env.example` lives
 * and where an operator writes one; then `apps/api`. The list used to name the root twice and
 * `apps/.env` once, so the package directory it described was never read.
 */
export function dotEnvCandidates(moduleDirectory: string): string[] {
  return [path.resolve(moduleDirectory, '../../../.env'), path.resolve(moduleDirectory, '../.env')];
}
