---
title: GitHub command center
description: Every open pull request and issue across your repositories in one place, a health grade for each repository, and the writes (merge, review, label, release, branch protection) that go back to GitHub.
outline: deep
---

# GitHub command center

Three pages under **GitHub** in the navigation. Each is one screen with nothing to scroll: a list on
the left, and everything known about the selected row on the right.

- **Pull requests** lists open pull requests across every repository, ranked by what you can do
  with them: what can be merged first, then what is stuck, then what is waiting. The counts sit on
  the filters (`Ready 2`, `Blocked 1`). The selected pull request shows its three gates (review,
  checks, merge) in words, a sentence saying what stands in the way, its branches, people, labels
  and size, and a **Merge** or **Update branch** button when one applies.
- **Issues** lists open issues, with the ones nobody has labelled or assigned marked and counted on
  the filter. The selected issue shows who owns it, its labels, comments and age.
- **Repositories** grades each repository, worst first. The selected repository shows every finding
  with the evidence behind it, a link to the list the finding counts, what is open, and the sync
  state. **Details** opens the same on a page of its own.

A list holds as many rows as fit the window and pages the rest (`1–8 of 11`). `j` and `k` move
through the rows, the detail follows, and `Enter` selects. On a narrow screen a row opens its
detail in place of the list, with a back button.

Reading costs no GitHub requests. The pages read the database that the [delivery
sync](/guide/delivery-performance) fills, so they are as fresh as the last sync (the repository
page shows when that was, and how much of GitHub's request budget is left).

## Turn it on for a repository

A project needs a `https://github.com/<owner>/<repo>` URL and a GitHub token saved on it. On the
**Repositories** page an operator sees **Turn on sync** beside any repository that is not being
read, which enables the delivery sync and queues the first read.

A repository that is not being read is **Not graded**. It is never shown with a good grade.

### What the token needs

| To do this                                                  | Fine-grained token permission                        |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| Read pull requests, issues, reviews, checks                 | Pull requests, Issues, Checks, Contents: **read**    |
| Read security alerts                                        | Dependabot, Code scanning, Secret scanning: **read** |
| Read branch protection                                      | Administration: **read**                             |
| Comment, label, assign, close, review, merge, update branch | Pull requests and Issues: **read and write**         |
| Re-run a workflow                                           | Actions: **write**                                   |
| Create a release                                            | Contents: **write**                                  |
| Protect a default branch                                    | Administration: **write**                            |

A permission the token lacks is not an error. An alert feed or branch protection the token cannot
read shows as a **note** ("could not be read"), and is counted neither for nor against the
repository.

### GitHub Enterprise Server

Set `GITHUB_API_URL` to the server's REST API, for example `https://ghe.example.com/api/v3`. It
must be `https:`; it is validated when the API starts, and repository URLs are read against that
host. One install talks to one GitHub: github.com repositories are not recognised once this is set.

## How a repository is graded

The score starts at 100 and loses a fixed amount per finding: critical 25, high 12, medium 5, low 2. A note costs nothing. The grade is A at 90, B at 75, C at 60, D at 40, F below that.

| Finding                                                                     | Severity      |
| --------------------------------------------------------------------------- | ------------- |
| Leaked secret alert open                                                    | critical      |
| Dependabot or code-scanning alert open                                      | by worst open |
| Default branch not protected                                                | high          |
| No license                                                                  | high          |
| Protection that requires neither review nor checks                          | medium        |
| Open pull requests: failing checks, conflicts, waiting for a first review   | medium        |
| Stale pull requests, missing community files, a backlog of untriaged issues | low           |
| A feed or setting the token could not read                                  | note          |

Every finding names what it counted ("3 open pull requests are failing checks"), so it can be
checked against GitHub in one click. The thresholds and penalties are two tables in
`apps/api/src/services/github-health.ts`.

## Writing to GitHub

Operators see **Actions** on every row and checkboxes for a selection. Viewers see neither; the API
refuses a non-operator regardless of what the page draws.

Everything goes through one door, `POST /api/v1/github/actions`, which accepts a closed set of
actions: comment, set labels, assign, close, reopen, request reviewers, review, merge, update
branch, re-run a workflow, create a release and protect the default branch. Nothing else can
reach GitHub through it.

- **A merge names the commit you looked at.** GitHub refuses it if the branch has moved, so a stale
  screen cannot merge commits nobody reviewed. A merge that goes against what the list shows
  (failing checks, no approval, conflicts) says so in words first.
- **Several at once are previewed first.** A preview asks GitHub for nothing and shows what each item
  would do; the button that applies it stays off until a preview of the same request has run, and
  editing the request discards the preview.
- **Protecting a branch never replaces protection.** GitHub's endpoint overwrites the whole rule, so
  Lupin reads the branch first and writes only if GitHub says it is not protected. A protected
  branch, or one whose protection the token cannot read, is left exactly as it is.
- **Each item is decided on its own.** A bulk request reports a result per item. A rate limit stops
  the batch, says when to come back, and does not ask GitHub again.
- **Every item is in the audit trail**: who, what, on which target, and how it ended. The row holds
  the length of a comment and the tag of a release, never their text, and never a token.

## Text in any script

The interface is English and left to right. What it shows is not always: a pull request title, an
issue, a label or a person's name can be Arabic or Hebrew. Text people wrote takes the direction
its own first letters give it, so an Arabic title aligns to the right and an English one to the
left in the same list. Names a machine gave (repositories, branches, paths) are isolated and kept
left to right, so `feature/login-fix` is never reordered. Search matches in any script.

## What it does not do

- It reads on the sync's schedule. GitHub webhooks make it faster, but they need LAN mode (see
  [LAN mode](/guide/lan-mode)); on a loopback install the next sync catches changes.
- It acts as whoever owns the token. There is no per-person GitHub sign-in yet, so GitHub shows
  the token's owner as the actor; Lupin's audit trail records which operator asked.
- A repository's failing default-branch CI is not graded: nothing the sync stores supports it yet.
