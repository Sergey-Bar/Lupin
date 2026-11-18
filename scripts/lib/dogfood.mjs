/**
 * What `pnpm dogfood` requires of an install that just graded this repository, kept pure so
 * the rule is tested without a stack (`dogfood.test.mjs`).
 *
 * A test suite's own red is not a dogfood failure: `lupin test` keeps the suite's exit code,
 * and a failing test is exactly what the install should now be showing. What fails is the loop
 * itself: a CLI that refused or could not reach the install (exit 2, 3, 4, or a crash), a gate
 * that answered with no verdict, or a project with no grade object and no release verdict.
 */

/** Exit codes that mean the CLI did its job, whatever the result: 0, or a suite's/gate's 1. */
const LOOP_OK = new Set([0, 1]);

/**
 * @param {{
 *   exits: Record<string, number>,
 *   health: unknown,
 *   readiness: unknown,
 * }} input
 * @returns {string[]}
 */
export function dogfoodProblems(input) {
  /** @type {string[]} */
  const problems = [];
  if (Object.keys(input.exits).length === 0) problems.push('no CLI step ran');
  for (const [step, code] of Object.entries(input.exits)) {
    if (!LOOP_OK.has(code))
      problems.push(`${step} exited ${String(code)}: the CLI could not complete it`);
  }
  const health = /** @type {Record<string, unknown> | null} */ (input.health);
  const grade = /** @type {Record<string, unknown> | undefined} */ (health?.['grade']);
  if (grade === undefined || grade === null || typeof grade !== 'object') {
    problems.push('the install returned no grade for the project');
  }
  const readiness = /** @type {Record<string, unknown> | null} */ (input.readiness);
  if (!['go', 'caution', 'no-go'].includes(String(readiness?.['verdict']))) {
    problems.push('the install returned no release verdict for the project');
  }
  return problems;
}
