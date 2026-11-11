---
title: Change risk
description: How Lupin scores a pull request's change risk from stated factors, catches tests weakened to pass, and puts the verdict on the pull request.
outline: deep
---

# Change risk

AI agents now open pull requests faster than anyone can read them. Change risk is how Lupin
tells you which ones to read first, and why, in a form you can check by hand.

Every pull request the gate sees gets a **level** (`low`, `medium`, `unknown`, `high`,
`critical`) and a **score**. The score is the sum of stated factors, each with its own sentence
and its points. Nothing in it is a judgement call: the points table is versioned
(`change-risk/1`), and an assessment made with another version is never compared with this one.

## What counts

| Factor                |              Points | When                                                              |
| --------------------- | ------------------: | ----------------------------------------------------------------- |
| Test tampering        |                  40 | `lupin diff-guard` found a change that weakens the tests          |
| New critical findings |                  40 | The branch adds a critical finding over the default branch        |
| Failed tests          |                  30 | A test fails on the head commit and quarantine does not excuse it |
| New high findings     |                  20 | The branch adds a high finding                                    |
| Diff coverage         |              10, 20 | Below 80%, below 50% of the changed lines covered                 |
| Size                  |              10, 20 | 400 or more lines, 1,000 or more                                  |
| Eval regression       |                  20 | An eval suite regressed against the default branch                |
| Blast radius          | 10 each, at most 20 | The change touches a sensitive area                               |
| Skipped phases        | 10 each, at most 20 | The change went past an SDLC phase without doing it               |
| Agent-authored        |                  15 | Attributed as written by an agent (5 for AI-assisted)             |
| No human approval     |                  15 | AI-written and no person approved it (5 for any other change)     |
| No test file touched  |                  10 | 50 or more lines changed and no test file among them              |
| Unexcused flaky       |                  10 | A test passed only on retry and is not quarantined                |

Below 20 points is **low**, below 40 **medium**, below 70 **high**, and 70 or more **critical**.
Two floors no sum can undercut: a new critical finding is at least **high**, and an AI-written
change that weakens its own tests is **critical**.

## Missing evidence is never safety

A change whose test results or diff coverage were not measured is **unknown** at best, never low.
A change already measured high or critical keeps that level: a missing reading never hides a
known risk. Every missing reading is listed with the step that would supply it.

To require more than tests and diff coverage, set it in `lupin.config.json`:

```json
{ "health": { "risk": { "require": ["tests", "diff-coverage", "tampering"] } } }
```

## Report first, block when you are ready

Installing this changes nobody's pull requests on day one: the risk is reported in the comment,
the check run and the dashboard, and the verdict is the gate's own. To fail the gate at a level:

```json
{ "health": { "risk": { "blockAt": "high", "blockOnUnknown": false } } }
```

## Catch tests weakened to pass

When an agent cannot make a test pass, it sometimes changes the test. `lupin diff-guard` reads
the job's own `git diff` and reports deleted tests, added `.skip`/`.only`/`xit`/`@Disabled`,
removed or loosened assertions, empty catches in tests, bulk snapshot updates, lowered coverage
thresholds, CI steps made unable to fail (`continue-on-error`, `|| true`) and added retries.

It sends kinds, paths and line numbers, **never a line of source**. Run it before the gate:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 } # the guard diffs against the base branch
- run: npx --yes @lupin/cli diff-guard --pr ${{ github.event.pull_request.number }}
  env:
    LUPIN_URL: ${{ vars.LUPIN_URL }}
    LUPIN_PROJECT: ${{ vars.LUPIN_PROJECT }}
    LUPIN_TOKEN: ${{ secrets.LUPIN_TOKEN }}
    LUPIN_COMMIT: ${{ github.event.pull_request.head.sha }}
```

`lupin diff-guard --dry-run` prints the findings and sends nothing, which needs no Lupin install.

## On the pull request

With a GitHub token of its own, the server posts the `lupin/health` status as it always has, a
`lupin/change-risk` check run beside it with the factors and line annotations, and leads the
sticky comment with the risk. A personal token cannot write check runs: the status and the
comment still post, and the check reads as unavailable.

A LAN install, or one with no token, has the job post instead, with its own token:

```yaml
permissions:
  checks: write
  pull-requests: write
  statuses: write
steps:
  - run: npx --yes @lupin/cli gate --pr ${{ github.event.pull_request.number }} --post
    env:
      LUPIN_URL: ${{ vars.LUPIN_URL }}
      LUPIN_PROJECT: ${{ vars.LUPIN_PROJECT }}
      LUPIN_TOKEN: ${{ secrets.LUPIN_TOKEN }}
      LUPIN_COMMIT: ${{ github.event.pull_request.head.sha }}
      GITHUB_TOKEN: ${{ github.token }}
```

`GITHUB_TOKEN` goes only to GitHub and `LUPIN_TOKEN` only to Lupin. A refusal from GitHub is
printed, and the job exits with the gate's verdict either way.

## In the dashboard

**Pull requests** shows each assessed row's level and a **High and above** filter. A level
assessed at an older head says so: the commits since have not been assessed. Each level links to
the pull request's own page: the band, every factor with its points, what was not measured, the
reach (sensitive areas, owning teams, tests that failed with these files), and the assessments
across its heads. **Home** lists an open pull request whose current head is high or critical.

## What it does not do yet

- A skipped SDLC phase adds points only for the phases the [phase model](/guide/phases-and-pace)
  can read; whether the gate passed at merge is not stored, so it never counts.
- `diff-guard` reads the diff it is given. A shallow clone without the base branch fails with the
  step to fix it, and a diff over 64 MiB is read in part and says so.
- The composite action shows the risk in the job summary; `diff-guard` and `--post` are CLI steps.
