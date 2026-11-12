# Send results from any CI (the `lupin` CLI)

`tools/lupin-cli` is a small Node command, `lupin`, with no dependencies of its own. It does
the four things a pipeline needs: upload a scanner report, ask for the pull-request gate, record a
deployment, and send the repository's agent configuration. On GitHub Actions the composite action
in `.github/actions/lupin-health` does the same four things, and its inputs are below.

## Configure it

The CLI reads its destination and credential from the environment, so the token never appears in
a command line, a shell history or a process listing:

- `LUPIN_URL` — your install's origin. `https://` anywhere; `http://` only to a loopback host
  (`localhost`, `127.0.0.0/8` — also as `::ffff:127.x.x.x` — or `::1`), the same rule as the MCP
  stdio proxy. Anything else is refused before a byte is sent, because the token would cross the
  network in the clear. The composite action's own check is stricter: `localhost`, `::1` or a
  numeric `127.d.d.d`, so a hostname such as `127.evil.example` never passes.
- `LUPIN_TOKEN` — an access token. For CI, an **uploader** token pinned to the project: it can
  send reports to that one project and read nothing.
- `LUPIN_PROJECT` — the project's id, from its page in the dashboard. `--project <id>` overrides it.

`--branch` and `--commit` default to `LUPIN_BRANCH` and `LUPIN_COMMIT`, then to GitHub
Actions' own `GITHUB_HEAD_REF`/`GITHUB_REF_NAME` and `GITHUB_SHA`.

Build it from a checkout with the rest of the workspace; the bin is `tools/lupin-cli/dist/index.js`.

## Commands

```bash
# A report, in any format the upload door reads (sarif, lcov, cyclonedx-json, stryker-mutation, …)
lupin upload --format sarif --file semgrep.sarif
lupin upload --format slsa-provenance --file provenance.json --digest sha256:<64 hex>

# The pull-request gate: exits 1 when it fails, printing every reason
lupin gate --branch "$BRANCH" --commit "$SHA" --pr 42

# Changes on this branch that weaken the tests: deleted tests, added skips, loosened
# assertions, lowered thresholds, CI steps that cannot fail. Sends kinds, paths and line
# numbers, never source; --dry-run sends nothing, --fail-on-findings fails the job.
lupin diff-guard --base origin/main

# The tests to run first for this branch's change, chosen by file name; sends nothing.
lupin impact --format paths

# Run the tests, send the report, and keep the command's exit code unless every failure is an
# approved quarantined test. The command runs without a shell; on Windows, `-- cmd /c npx …`.
lupin test --format playwright-json --report results.json -- npx playwright test --reporter=json

# Which files this shard runs, balanced by how long each took. Never drops a file: if the plan
# cannot be had, it prints them all. Every shard of one CI run sends the commit time as the
# history cut-off (override with --as-of), so separate shards get one plan.
npx playwright test $(lupin shard --total 4 --index 2 -- $(git ls-files 'e2e/*.spec.ts'))

# A deployment, through the delivery push door, for the DORA scorecard.
# Also: --id, --url, --created-at, and the switches --rollback, --hotfix, --unplanned
lupin deploy --environment production --status success --sha "$SHA"

# AGENTS.md, CLAUDE.md, .cursor/rules, .mcp.json, SKILL.md … under a directory.
# Needs a branch: --branch, LUPIN_BRANCH, or GitHub Actions' own
lupin agent-config --dir .

# The dashboard as one HTML file that fetches nothing: attach it, or publish it as a CI artifact.
# Reads the project's default branch unless --branch names another; --window 7d|release.
lupin report --out artifacts/dashboard.html
```

`report` writes the file only if the server answered with a page, so a proxy's error page is never
published as the report. Publishing it from GitHub Actions is one more step:

```yaml
- run: lupin report --out artifacts/dashboard.html
- uses: actions/upload-artifact@v4
  with:
    name: dashboard
    path: artifacts/dashboard.html
```

The file needs no account to open. It is a snapshot: it does not update, runs no script and makes
no network request. Its only addresses are the GitHub links a reader follows. Anyone who can
download the artifact can read the numbers in it, so publish it where the repository's own
readers are.

`upload` also takes `--source-root` (default `GITHUB_WORKSPACE`): the checkout a SARIF scanner ran
in, so the absolute paths it wrote become repository-relative.

A misspelt option is refused rather than ignored: a step that silently dropped `--commit` would
gate the wrong commit.

## GitLab CI

Every command runs in a GitLab job too. The CLI reads the branch, commit, merge request and
target branch from GitLab's own variables (`CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`,
`CI_COMMIT_SHA`, `CI_MERGE_REQUEST_IID`, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`), so a merge
request pipeline needs no flags:

```yaml
lupin:
  image: node:24
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: 0 # diff-guard and impact compare with the target branch
  script:
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - npx --yes @lupin/cli diff-guard --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - npx --yes @lupin/cli gate --post
```

`gate --post` writes the verdict as a commit status named `lupin/health` and the gate's comment
as one merge request note, updated on every push. GitLab has no check runs, so the risk factors
are in the note. Give it `LUPIN_GITLAB_TOKEN`, a project access token with the `api` scope, as a
masked variable: GitLab's job token cannot write statuses or notes. That token goes only to
`CI_API_V4_URL`, which must be `https://`, and never to Lupin; a refusal from GitLab is printed
and never changes the exit code.

What is not there yet: the server does not sync merge requests, pipelines or deployments from
GitLab, so delivery metrics, SDLC phases and the pull request pages are GitHub only.

## Run the tests this change needs first

`lupin impact` reads the branch's changed files and prints the tests to run first: the test files
the change touched, and the tests named after the source files it touched (`cart.ts` →
`cart.test.ts`, `__tests__/cart.ts`, `test_cart.py`, `cart_test.go`), the nearest one first. It
also lists the changed source files no test is named after, so a change nothing covers is seen.

```bash
lupin impact --base origin/main               # what to run, and why
npx vitest run $(lupin impact --format paths) # straight into the test runner
lupin impact --format json                    # for a script
```

It reads git in the job and sends nothing, so it needs no token and no Lupin install. When the
change touched what every test depends on (a manifest, a lockfile, a `tsconfig`, a test runner
config), the selection is not trusted: the text says to run everything, and `--format paths`
prints every test file. The selection is by name only; a test that covers a file it is not named
after is not found, which is why it is a list to run first and not a list to run instead.

## Exit codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 0    | Done; for `gate`, the gate passed.                              |
| 1    | The gate failed. Nothing went wrong: the answer was no.         |
| 2    | The command line or the environment is wrong. Nothing was sent. |
| 3    | The server refused the request, or could not be reached.        |
| 4    | The token was refused (401 or 403).                             |

A refusal prints the server's own error code and sentence, never the token.

## The GitHub composite action

```yaml
- uses: your-org/Lupin/.github/actions/lupin-health@<pinned sha>
  with:
    url: https://lupin.example.com
    project-id: ${{ vars.LUPIN_PROJECT }}
    token: ${{ secrets.LUPIN_UPLOADER_TOKEN }}
    reports: |
      sarif:semgrep.sarif
      lcov:coverage/lcov.info
      git-diff:changes.diff
    agent-config: 'true'
    deployment-environment: production
```

| Input                    | Default   | What it does                                                           |
| ------------------------ | --------- | ---------------------------------------------------------------------- |
| `url`                    | required  | The install's origin. Refused unless `https://` or loopback `http://`. |
| `project-id`             | required  | The project's id.                                                      |
| `token`                  | required  | An uploader token for the project.                                     |
| `reports`                | required  | One `format:path` per line. A missing file fails the step.             |
| `codeowners`             | `'true'`  | Send CODEOWNERS so findings get owners.                                |
| `gate`                   | `'true'`  | Ask for the gate, and fail the job when it fails. Output `verdict`.    |
| `agent-config`           | `'false'` | Send the tracked agent instruction and MCP configuration files.        |
| `deployment-environment` | `''`      | Record a deployment of this commit to the named environment.           |
| `deployment-status`      | `success` | `success` or `failure`, for that deployment.                           |

Every input the action had before is unchanged. The token goes to curl through the environment and
a header file, never argv.
