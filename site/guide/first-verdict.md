# Your first release verdict, in thirty minutes

For a QA engineer or SDET with a repository and a CI pipeline. Each step says how you know it
worked; if one does not, stop there, because every later step depends on it.

| When  | Step                                  | How you know                                         |
| ----- | ------------------------------------- | ---------------------------------------------------- |
| 0:00  | [Install](install.md) and start Lupin | `http://localhost:8080` opens on the setup guide     |
| 5:00  | Connect your repository               | Settings → Projects says how many commands it found  |
| 8:00  | Create an uploader token              | Settings → Access shows a token starting `lup_`      |
| 10:00 | Add the CLI to one CI job (below)     | The job log ends with `Gate passed` or `Gate failed` |
| 25:00 | Open Home                             | It says Ready, Caution or No-go, and why             |

## Connect a repository

**Settings → Projects → Connect a repository.** Give the folder path the server can read, or a git
URL and, for a private repository, a token. Lupin reads the manifests and lists the test commands
it found. Nothing in the repository is changed.

## Issue an uploader token

**Settings → Access → New token**, role **uploader**, pinned to the project. An uploader token can
only send reports to that one project: it cannot read anything, and a token for project A is
refused by project B (the CLI exits `4`). Store it as a masked CI secret named `LUPIN_TOKEN`.

## Add it to CI

The CLI has no runtime dependencies and needs Node 24. Pin the major version, `@lupin/cli@^5`.

### GitHub Actions

```yaml
- name: Tests, recorded in Lupin
  env:
    LUPIN_URL: https://lupin.example.com
    LUPIN_TOKEN: ${{ secrets.LUPIN_TOKEN }}
    LUPIN_PROJECT: 00000000-0000-4000-8000-000000000000
  run: npx --yes -p @lupin/cli@^5 lupin test --format junit --report reports/junit.xml -- npm test
- name: Release gate
  if: always()
  env:
    LUPIN_URL: https://lupin.example.com
    LUPIN_TOKEN: ${{ secrets.LUPIN_TOKEN }}
    LUPIN_PROJECT: 00000000-0000-4000-8000-000000000000
  run: npx --yes -p @lupin/cli@^5 lupin gate --branch "$GITHUB_HEAD_REF$GITHUB_REF_NAME" --commit "$GITHUB_SHA"
```

### GitLab CI

```yaml
test:
  image: node:24
  variables:
    LUPIN_URL: https://lupin.example.com
    LUPIN_PROJECT: 00000000-0000-4000-8000-000000000000
  script:
    # LUPIN_TOKEN is a masked CI/CD variable. Branch and commit come from GitLab's own variables.
    - npx --yes -p @lupin/cli@^5 lupin test --format junit --report reports/junit.xml -- npm test
    - npx --yes -p @lupin/cli@^5 lupin gate
```

### Jenkins

```groovy
stage('Test') {
  environment {
    LUPIN_URL = 'https://lupin.example.com'
    LUPIN_TOKEN = credentials('lupin-uploader-token')
    LUPIN_PROJECT = '00000000-0000-4000-8000-000000000000'
  }
  steps {
    sh 'npx --yes -p @lupin/cli@^5 lupin test --format junit --report reports/junit.xml --branch "$BRANCH_NAME" --commit "$GIT_COMMIT" -- npm test'
    sh 'npx --yes -p @lupin/cli@^5 lupin gate --branch "$BRANCH_NAME" --commit "$GIT_COMMIT"'
  }
}
```

### Playwright, streamed while it runs

```js
// playwright.config.ts
export default defineConfig({
  reporter: [['list'], ['@lupin/playwright-reporter']],
});
```

Set `LUPIN_URL` and `LUPIN_REPORTER_SECRET` in the job. The reporter never changes your run's exit
code: if Lupin is down, it says so on stderr and your tests pass or fail as they would have.

## What the exit codes mean

`lupin test` exits with your suite's own code, or `0` when every failure is an approved
quarantined test. `lupin gate` exits `0` when the gate passes and `1` when it fails, printing every
reason. `2` is a usage or configuration error and nothing was sent; `3` means the install refused
or could not be reached; `4` means the token was refused. See [the CLI](cli.md#exit-codes).

## Read the verdict

**Home** opens on the release verdict for the project chosen in the sidebar: **Ready**, **Caution**
or **No-go**, the first reason, and what needs you. **Tests** lists the flaky tests (a test that
passed, failed and passed again is flaky) and the failures grouped by cause. **Health** has the
repository grade. Each number links to the evidence it was computed from.

Next: [connect a chat platform](notifications.md), [ask from your editor](mcp.md), or read
[what this release does not do yet](known-limitations.md).
