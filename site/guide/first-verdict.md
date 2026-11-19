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

The project id for `LUPIN_PROJECT` is the id in the project page address,
`/dashboard/repo/<id>`, and in **Settings › Projects**.

## Add it to CI

The CLI has no runtime dependencies and needs Node 24. Pin the major version, `@lupin/cli@^5`.

::: warning The CLI is not on npm yet
Until `@lupin/cli` is published, `npx -p @lupin/cli@^5` fails. Build it from a checkout
(`pnpm install && pnpm build`) and run `node tools/lupin-cli/dist/index.js` in its place; see
[the CLI](cli.md).
:::

**Your CI job must reach the install.** `localhost:8080` only works for a runner on the same
machine. A hosted runner needs the install on an address it can reach: [LAN mode](lan-mode.md)
for a runner on your network, or [a remote profile](remote-cloudflare.md) for a hosted one.
Otherwise use a self-hosted runner on the Lupin host.

The `--format` names differ between the two doors: the CLI says `playwright-json`, the raw
upload form field says `playwright`. JUnit is `junit` in both.

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
  run: npx --yes -p @lupin/cli@^5 lupin gate
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
  // The branch and commit come from Jenkins: CHANGE_BRANCH or BRANCH_NAME, and GIT_COMMIT.
  steps {
    sh 'npx --yes -p @lupin/cli@^5 lupin test --format junit --report reports/junit.xml -- npm test'
    sh 'npx --yes -p @lupin/cli@^5 lupin gate'
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

Set `LUPIN_URL`, `LUPIN_REPORTER_SECRET` and `LUPIN_PROJECT` in the job. Without
`LUPIN_PROJECT` the streamed run belongs to no project, and the gate never sees it. The secret is the install's own
`REPORTER_SECRET`, from the `.env` the installer wrote; store it as a masked CI secret. The reporter never changes your run's exit
code: if Lupin is down, it says so on stderr and your tests pass or fail as they would have.

## What the exit codes mean

`lupin test` exits with your suite's own code, or `0` when every failure is an approved
quarantined test. `lupin gate` exits `0` when the gate passes and `1` when it fails, printing every
reason. It fails on the health gates, on any failing test uploaded for that commit by any
job or shard (a re-run replaces the result it repeats), and on a commit no test results were
uploaded for. A job that only sends scans passes `--allow-no-tests`. `2` is a usage or configuration error and nothing was sent; `3` means the install refused
or could not be reached; `4` means the token was refused. See [the CLI](cli.md#exit-codes).

## Read the verdict

**Home** opens on the release verdict for the project chosen in the sidebar: **Ready**, **Caution**
or **No-go**, the first reason, and what needs you. **Ready** needs every signal measured,
coverage included: until a coverage report is scanned or uploaded, the best Home can say is
**Caution**, naming what is not measured. **Tests** lists the flaky tests (a test that
passed, failed and passed again is flaky) and the failures grouped by cause. **Health** has the
repository grade. Each number links to the evidence it was computed from.

**Home and `lupin gate` answer different questions.** `lupin gate` judges one commit: its
tests and its scans. Home judges the release branch over the last seven days: the latest run
gate, the pass rate, flaky tests, coverage and pending quarantine. The release branch is the project's default branch: the one given when it was connected by git
URL, or the one its checkout's git metadata names for a folder. **Settings › Projects › Rename** changes it. A commit can pass `lupin gate` while Home says Caution,
for example because coverage is not measured yet.

Next: [connect a chat platform](notifications.md), [ask from your editor](mcp.md), or read
[what this release does not do yet](known-limitations.md).
