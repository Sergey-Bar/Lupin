/**
 * Every environment variable the CLI reads, by name, in one place — so what it reads is a list
 * a reviewer can see rather than "whatever is in `process.env`", and nothing else in the
 * environment reaches a command.
 */
export function readEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    LUPIN_URL: process.env['LUPIN_URL'],
    LUPIN_TOKEN: process.env['LUPIN_TOKEN'],
    LUPIN_PROJECT: process.env['LUPIN_PROJECT'],
    LUPIN_BRANCH: process.env['LUPIN_BRANCH'],
    LUPIN_COMMIT: process.env['LUPIN_COMMIT'],
    LUPIN_BASE: process.env['LUPIN_BASE'],
    // GitHub Actions' own, so a step on Actions needs no flags for the branch and commit.
    GITHUB_HEAD_REF: process.env['GITHUB_HEAD_REF'],
    GITHUB_BASE_REF: process.env['GITHUB_BASE_REF'],
    GITHUB_REF_NAME: process.env['GITHUB_REF_NAME'],
    GITHUB_SHA: process.env['GITHUB_SHA'],
    GITHUB_WORKSPACE: process.env['GITHUB_WORKSPACE'],
    GITHUB_RUN_ID: process.env['GITHUB_RUN_ID'],
    GITHUB_RUN_ATTEMPT: process.env['GITHUB_RUN_ATTEMPT'],
  };
}
