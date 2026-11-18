/**
 * What an upgrade from the last release must keep, decided from readings taken before and after
 * so the rule is tested without a stack (`upgrade-rehearsal.test.mjs`). The rehearsal itself is
 * `scripts/upgrade-rehearsal.mjs`.
 *
 * @typedef {{
 *   version: string,
 *   envDigest: string,
 *   projects: string[],
 *   findings: number,
 *   runs: number,
 * }} InstallReading
 */

/**
 * @param {{ before: InstallReading, after: InstallReading, rolledBack?: InstallReading | null, candidate: string }} input
 * @returns {string[]}
 */
export function upgradeProblems(input) {
  /** @type {string[]} */
  const problems = [];
  const { before, after, rolledBack } = input;
  if (after.version !== input.candidate) {
    problems.push(`the install reports ${after.version} after the update, not ${input.candidate}`);
  }
  if (after.envDigest !== before.envDigest) problems.push('.env changed across the update');
  for (const slug of before.projects) {
    if (!after.projects.includes(slug)) problems.push(`project ${slug} is gone after the update`);
  }
  if (after.findings < before.findings) {
    problems.push(
      `findings fell from ${String(before.findings)} to ${String(after.findings)} across the update`,
    );
  }
  if (after.runs < before.runs) {
    problems.push(
      `runs fell from ${String(before.runs)} to ${String(after.runs)} across the update`,
    );
  }
  if (rolledBack !== undefined && rolledBack !== null) {
    if (rolledBack.version !== before.version) {
      problems.push(`the rollback reports ${rolledBack.version}, not ${before.version}`);
    }
    for (const slug of before.projects) {
      if (!rolledBack.projects.includes(slug))
        problems.push(`project ${slug} is gone after the rollback`);
    }
  }
  return problems;
}
