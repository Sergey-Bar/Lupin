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

/** @param {InstallReading} before @param {InstallReading} after @param {string} when */
function lostProjects(before, after, when) {
  return before.projects
    .filter((slug) => !after.projects.includes(slug))
    .map((slug) => `project ${slug} is gone after the ${when}`);
}

/** @param {InstallReading} before @param {InstallReading} after */
function lostCounts(before, after) {
  return /** @type {const} */ (['findings', 'runs'])
    .filter((field) => after[field] < before[field])
    .map(
      (field) =>
        `${field} fell from ${String(before[field])} to ${String(after[field])} across the update`,
    );
}

/**
 * @param {{ before: InstallReading, after: InstallReading, rolledBack?: InstallReading | null, candidate: string }} input
 * @returns {string[]}
 */
export function upgradeProblems(input) {
  const { before, after, rolledBack } = input;
  const update = [
    ...(after.version === input.candidate
      ? []
      : [`the install reports ${after.version} after the update, not ${input.candidate}`]),
    ...(after.envDigest === before.envDigest ? [] : ['.env changed across the update']),
    ...lostProjects(before, after, 'update'),
    ...lostCounts(before, after),
  ];
  if (rolledBack === undefined || rolledBack === null) return update;
  return [
    ...update,
    ...(rolledBack.version === before.version
      ? []
      : [`the rollback reports ${rolledBack.version}, not ${before.version}`]),
    ...lostProjects(before, rolledBack, 'rollback'),
  ];
}
