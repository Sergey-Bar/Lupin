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
    // `lupin gate --post` only: the job's own token, and where to send it. Never sent to Lupin.
    GITHUB_TOKEN: process.env['GITHUB_TOKEN'],
    GITHUB_REPOSITORY: process.env['GITHUB_REPOSITORY'],
    GITHUB_API_URL: process.env['GITHUB_API_URL'],
    // GitLab CI's own: the branch, commit and merge request every command reads there, and what
    // `lupin gate --post` needs to write a commit status and a merge request note.
    GITLAB_CI: process.env['GITLAB_CI'],
    CI_COMMIT_REF_NAME: process.env['CI_COMMIT_REF_NAME'],
    CI_COMMIT_SHA: process.env['CI_COMMIT_SHA'],
    CI_MERGE_REQUEST_IID: process.env['CI_MERGE_REQUEST_IID'],
    CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: process.env['CI_MERGE_REQUEST_SOURCE_BRANCH_NAME'],
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME: process.env['CI_MERGE_REQUEST_TARGET_BRANCH_NAME'],
    CI_PROJECT_ID: process.env['CI_PROJECT_ID'],
    CI_API_V4_URL: process.env['CI_API_V4_URL'],
    // `--post` on GitLab only. Never sent to Lupin.
    LUPIN_GITLAB_TOKEN: process.env['LUPIN_GITLAB_TOKEN'],
    // An install behind Cloudflare Access: the service token pair, sent only to LUPIN_URL.
    LUPIN_CF_ACCESS_CLIENT_ID: process.env['LUPIN_CF_ACCESS_CLIENT_ID'],
    LUPIN_CF_ACCESS_CLIENT_SECRET: process.env['LUPIN_CF_ACCESS_CLIENT_SECRET'],
    // `lupin shard --as-of`, as a variable, so every shard of one CI run plans the same.
    LUPIN_SHARD_AS_OF: process.env['LUPIN_SHARD_AS_OF'],
  };
}
