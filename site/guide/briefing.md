---
title: The briefing
description: What happened while you were away, for one repository or all of them, every line cited, with optional wording by a model that is checked against the lines.
outline: deep
---

# The briefing

Back from a week off, or reading on a Monday: the briefing says what happened over the window
in a handful of lines, and each line names where its number came from.

## What it says

The briefing has five sections, and only a section with something in it is shown:

| Section          | What it holds                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Shape            | Lines changed, new tests per 1,000 lines, the untested-change debt; the [phase](/guide/phases-and-pace) holding changes up |
| Shipped          | Pull requests merged, and how many an AI wrote; deployments to production                                                  |
| Riskier          | Merged at high risk or above, AI-written merged with no person approving, merged with changes that weakened its tests      |
| Quality          | The dashboard's own sentence on whether quality got better or worse                                                        |
| Needs a decision | Open pull requests assessed high or critical at their current head, worst first                                            |

A window where nothing happened is one line saying so. A repository the delivery sync has never
read says "turn on delivery sync" rather than "0 merged", because zero and unknown are different
answers.

Every line carries its evidence (`pull-requests:merged:project:…:7d`, `diff-guard:…`, a pull
request), shown under **Read from** on the page.

## Where you see it

- **Home, Release view**: a card with the shape, the headline and the three worst lines.
- **`/dashboard/briefing`**: the whole briefing, for the portfolio or, with `?project=`, one
  repository, over 7 or 30 days.
- **Scheduled reports**: a "While you were away" block after the dashboard's headline, cut to
  each platform's message limit like every other line.
- **Your editor**: the MCP tool `get_briefing` (see [MCP](/guide/mcp)).
- **The API**: `GET /api/v1/projects/:id/briefing?days=7` and `GET /api/v1/portfolio/briefing`.

## Wording by a model

**Word it for me** on the briefing page asks the AI provider configured under Settings to
reword the lines as a few sentences. It is never asked for unless you press it.

The model is sent the lines' ids, sections and sentences, and nothing else: no source code, no
diff, no evidence paths. It must answer with sentences that each cite the lines they reword, and
the whole wording is thrown away if any sentence:

- cites nothing, or a line that is not in the briefing; or
- uses a number none of the lines it cites says.

A thrown-away wording is shown with its reason, and the lines stand as written. A wording is kept
in memory for ten minutes, so pressing again does not ask again; nothing is stored. Each request
is recorded as agent `lupin-briefing` on the agent runtime page, with its tokens and no content.

## What it does not do yet

- There is no setting to send diff hunks to the model; the wording only ever sees the lines.
- No run against a real model is recorded; the checks are proven against stub providers.
