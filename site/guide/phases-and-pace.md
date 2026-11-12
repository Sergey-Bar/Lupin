---
title: Phases, pace and shape
description: Where every change is in plan, code, test, review and release, which phase is holding work up, whether testing keeps up with the code, and whether each level is in good shape.
outline: deep
---

# Phases, pace and shape

Two questions a QA lead asks every week: where is each change stuck, and are the tests keeping
up with how fast code arrives? Lupin answers both from what it already reads: pull requests,
the runs on their heads, diff coverage and `lupin diff-guard`. Neither needs a new upload.

## The five phases

Every pull request the delivery sync has read is placed in five phases, in order:

| Phase   | Done when                                                                                  |
| ------- | ------------------------------------------------------------------------------------------ |
| Plan    | The pull request's body links an issue (`#12`, `org/repo#12`, `ABC-12`, an `/issues/` URL) |
| Code    | It is out of draft                                                                         |
| Test    | A run was recorded on its head commit, and diff-guard found nothing that weakens the tests |
| Review  | A person approved it                                                                       |
| Release | It merged                                                                                  |

Each phase is **Done**, **In progress**, **Not yet**, **Skipped** or **Not measured**, with the
reason in a sentence and the hours it has spent there.

Two rules decide the state:

- **No evidence is not done.** A phase Lupin could not read is _Not measured_, never _Done_.
- **Going past a phase skips it.** A change merged with no person approving skipped review; one
  approved with no tests on its head skipped test. A skipped phase adds points to the
  [change risk](/guide/change-risk).

An open change counts as stuck after 72 hours in code, 48 in review and 24 waiting to release.

## Where you see it

- **A pull request's page** shows its five phases as a strip.
- **Repository 360** shows each phase across the window's changes, the bottleneck in one
  sentence ("Review is the bottleneck: 2 changes waiting over 48 hours."), and what is stuck,
  longest first.
- **Portfolio** shows every repository's shape per phase, worst first, so a failing phase across
  teams is one column.

The reads behind them are `GET /api/v1/projects/:id/pull-requests/:number/phases`,
`GET /api/v1/projects/:id/phases?days=30` and `GET /api/v1/portfolio/phases?days=30`.

## Pace

Pace is on Repository 360, one row per week:

- **Changed lines**, and how many of them an AI wrote;
- **New tests per 1,000 changed lines**: test identities first seen in a run that week;
- **Untested-change debt**: executable changed lines that merged with no test running them,
  summed week over week. It never goes down: a line that merged untested stays counted.

Lines whose diff coverage was never measured are counted apart, as **not measured**. They are
never counted as covered, and never silently as untested either. To measure them, upload
coverage for the commit (see [Repository health](/guide/repository-health#supply-chain-accessibility-mutation-and-diff-coverage)).

`GET /api/v1/projects/:id/pace?weeks=8` returns the same rows.

## Good shape or bad shape

Every level has one verdict, **Good**, **Caution**, **Bad** or **Not measured**, and says how
fresh its evidence is. The zoom bar at the top of Portfolio, Repository 360 and a pull request's
page shows the levels above you, each with its verdict, and the reason and age of the one you
are on.

| Level        | Read from                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------- |
| Pull request | Its change risk at the latest head, and its five phases                                      |
| Repository   | Its health grade, its last finished run, its phases over 30 days, its open high-risk changes |
| Portfolio    | Every repository's signals together                                                          |

Three rules hold at every level:

- **A signal that was not measured keeps the verdict from Good.** It reads Caution and names
  what is missing ("Not measured: tests.").
- **Evidence older than seven days keeps the verdict from Good,** and the bar says _stale_. A
  stale Bad stays Bad: old bad news is still bad news.
- **A bad signal never improves the verdict.**

The reads are `GET /api/v1/projects/:id/shape`, `GET /api/v1/projects/:id/pull-requests/:number/shape`
and `GET /api/v1/portfolio/shape`.

## What it does not do yet

- Whether the gate passed at merge is not stored, so the release phase never reads it.
- A pull request's plan phase reads its body only; a linked issue set in GitHub's sidebar and not
  in the body is not seen.
- Pace reads the pull requests the delivery sync has read. Commits pushed straight to the default
  branch are not counted.
