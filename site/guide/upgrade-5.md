# Upgrade from 4.x to 5.0

5.0.0 keeps your data, your `.env` and your connected platforms. The migrations run on start. The
upgrade and a rollback to the backup are rehearsed from the published 4.1.0 zip before every
release (`pnpm upgrade:rehearse`, in the release gate).

## Before you start

1. **Back up.** In the install folder: `./start.sh backup` (Windows: `start.cmd backup`). It writes
   the database, the stored artifacts and `.env` to `backups/lupin-<time>`, each with a digest.
2. **Keep a copy of `.env` somewhere else.** It holds the key that encrypts stored credentials.

## Upgrade

```sh
./start.sh update --version 5.0.0
```

The script records the version, downloads the images, starts the stack and waits until it is
ready. Your projects, runs, findings and settings are still there.

## Roll back

```sh
./start.sh update --version 4.1.0
./start.sh restore backups/lupin-<time>
```

A backup only restores into the release that took it or a newer one, and the script refuses
otherwise rather than guess.

## What changed

Nothing in 5.0.0 removes a route, a setting or a stored field. These are the changes you may notice.

| Change                                                                                           | What you see                                                        | What to do                                                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@lupin/cli` and `@lupin/playwright-reporter` move from 1.0.0 to 5.0.0, in step with the product | `npx @lupin/cli` resolves 5.x                                       | Pin `@lupin/cli@^5` in CI                                                                                 |
| A test report may be up to 32 MiB (was 5 MiB), about 250 000 test cases                          | Large suites upload instead of failing with `PAYLOAD_TOO_LARGE`     | Nothing                                                                                                   |
| Failure messages are stored with credentials redacted                                            | A token a log printed shows as `[redacted]`                         | Nothing; older runs are unchanged                                                                         |
| A plain JUnit upload no longer counts as a measured Tests score of 0                             | A repository's grade no longer drops to F when CI sends green tests | Nothing                                                                                                   |
| A run recorded from an uploaded report is judged by the quality gate                             | Home's gate reason follows CI uploads                               | Nothing                                                                                                   |
| The Playwright reporter declares `@playwright/test >= 1.40.0` as an optional peer                | `npm` warns on an older Playwright                                  | Use 1.40 or newer                                                                                         |
| `lupin gate` fails a commit no test results were uploaded for                                    | A scan-only pipeline goes red                                       | Add `--allow-no-tests`, or the action input `allow-no-tests`                                              |
| `lupin gate` judges every run on a commit, not only the newest                                   | A failing shard is no longer hidden by a later one                  | Nothing                                                                                                   |
| A flaky test counts as passed for the pass rate, and a new policy allows 5% flaky tests          | One flaky test no longer fails a run twice                          | A policy created on 4.x keeps its own `maxFlakyRate`; raise it in **Settings › Quality gates** if it is 0 |

The full list is in the [changelog](https://github.com/Sergey-Bar/Lupin/blob/main/docs/CHANGELOG.md).
