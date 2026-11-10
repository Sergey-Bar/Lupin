# QA user study: does the console answer the questions it was redesigned for?

A moderated session with 3 to 5 people who do QA for a living, half engineers who triage
failures and half leads who decide releases. The redesign made claims (one verdict per page,
failures grouped by cause, a copilot that cites what it read). This study is how those claims
get checked against people instead of against our own reading.

## Before the session

- A local install seeded with the demo data, plus at least one red run whose failures have
  real error messages, so grouping has something to group.
- One browser window at 1440 x 900, and one phone at 390 wide for task 6.
- Settings: default theme and density. No model configured, so the copilot answers from rules.
- The moderator reads the tasks aloud and does not point at the screen.

## The tasks

Each task names the question, where the participant starts, and what counts as success. Time
each one from the end of the reading to the participant's answer.

| #   | Question read aloud                                                  | Starts on      | Success                                                        |
| --- | -------------------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| 1   | "Can we ship today? Tell me why or why not."                         | Home           | States the verdict and at least one reason, in their own words |
| 2   | "Main is red. What broke it, and how many tests did it take down?"   | Home           | Names the biggest cause and its test count                     |
| 3   | "When was this branch last green?"                                   | A red run      | Opens the last green run from the run page                     |
| 4   | "Ask Lupin which tests are flaky."                                   | Any page       | Uses the command palette or panel and reads the answer         |
| 5   | "Retry only the tests that failed, but make sure nothing else runs." | A red run      | Retries with the failed scope, after confirming                |
| 6   | "On your phone: is anything on fire right now?"                      | Home, 390 wide | Answers within 10 seconds                                      |
| 7   | "Quarantine the flakiest test. Who has to approve that?"             | Tests          | Requests quarantine and says it waits for approval             |
| 8   | "Find the supply-chain report for this project."                     | Health         | Reaches it, through More if needed                             |

## After each task

Ask two questions and write the answers down verbatim:

1. "How sure are you of that answer, from 1 (guessing) to 5 (certain)?"
2. "What did you expect to see that was not there?"

## Scoring sheet

Fill one row per participant per task. A task passes only on success **and** confidence of 4
or more: a right answer the person does not trust is not a working screen.

| Participant | Role (engineer / lead) | Task | Seconds | Success (y/n) | Confidence (1–5) | Expected but missing |
| ----------- | ---------------------- | ---- | ------- | ------------- | ---------------- | -------------------- |
|             |                        | 1    |         |               |                  |                      |
|             |                        | 2    |         |               |                  |                      |
|             |                        | 3    |         |               |                  |                      |
|             |                        | 4    |         |               |                  |                      |
|             |                        | 5    |         |               |                  |                      |
|             |                        | 6    |         |               |                  |                      |
|             |                        | 7    |         |               |                  |                      |
|             |                        | 8    |         |               |                  |                      |

## Reading the results

- **A task that fails for two or more people is a defect**, not a training issue. File it with
  the task number, the seconds, and the verbatim "expected but missing" answers.
- **Compare engineers and leads on tasks 1 and 2.** The two Home views exist because the roles
  were assumed to need different things; if both roles pass both tasks in one view, the split
  is not earning its place.
- **Task 4 tests the copilot's honesty.** If a participant repeats a number from its answer,
  check that number against the runs. A wrong number is a blocker for the copilot, whatever
  the other tasks say.
- Report the median seconds per task and the pass count out of the participants. With five
  people, report counts rather than percentages.
